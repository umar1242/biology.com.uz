import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  certCalibrationRuns,
  certExamAnswers,
  certExamAttempts,
  certItemCalibrations,
  certItems,
} from "../db/schema.js";
import { isClosedTask, maxPointsFor } from "./certExam.js";
import { calibrate, calibrationState, type RaschResponse } from "./rasch.js";
import { bandPoints, calibratePartialCredit, type PolytomousResponse } from "./pcm.js";

/**
 * Collects every graded answer belonging to one teacher into a single response
 * matrix — pointedly NOT split by variant, unlike discriminationByItem() in
 * routes/certExams.ts, which has to rank students within one exam.
 *
 * Pooling is what makes difficulties comparable across variants, and it is
 * legitimate here only because items keep their identity in the bank: the same
 * question asked in two variants is the same column.
 */
export async function collectResponses(teacherId: number): Promise<RaschResponse[]> {
  const rows = await db
    .select({
      itemId: certExamAnswers.itemId,
      attemptId: certExamAnswers.attemptId,
      taskNumber: certExamAnswers.taskNumber,
      isCorrect: certExamAnswers.isCorrect,
      awardedPoints: certExamAnswers.awardedPoints,
    })
    .from(certExamAnswers)
    .innerJoin(certExamAttempts, eq(certExamAttempts.id, certExamAnswers.attemptId))
    .innerJoin(certItems, eq(certItems.id, certExamAnswers.itemId))
    .where(
      and(
        eq(certItems.teacherId, teacherId),
        sql`${certExamAttempts.status} IN ('submitted','reviewed')`,
        sql`${certExamAnswers.itemId} IS NOT NULL`,
      ),
    );

  const responses: RaschResponse[] = [];
  for (const r of rows) {
    if (r.itemId === null) continue;
    // Tasks 41–43 are scored 0–35, not right/wrong. A dichotomous Rasch model
    // has nothing to say about them; they need the partial-credit variant,
    // which is a separate piece of work.
    if (r.taskNumber > 40) continue;

    const solved = isClosedTask(r.taskNumber)
      ? r.isCorrect
      : r.awardedPoints === null
        ? null
        : r.awardedPoints >= 1;
    if (solved === null) continue;

    responses.push({ personId: r.attemptId, itemId: r.itemId, correct: solved });
  }
  return responses;
}

/**
 * Ответы на задания 41–43 — те, что оцениваются баллами, а не «верно/неверно».
 *
 * Баллы сводятся в пять ступеней прямо здесь: тридцать порогов на тридцать
 * баллов не оценить ни на какой реальной когорте (см. bandPoints).
 */
async function collectPolytomous(teacherId: number): Promise<PolytomousResponse[]> {
  const rows = await db
    .select({
      itemId: certExamAnswers.itemId,
      attemptId: certExamAnswers.attemptId,
      taskNumber: certExamAnswers.taskNumber,
      awardedPoints: certExamAnswers.awardedPoints,
    })
    .from(certExamAnswers)
    .innerJoin(certExamAttempts, eq(certExamAttempts.id, certExamAnswers.attemptId))
    .innerJoin(certItems, eq(certItems.id, certExamAnswers.itemId))
    .where(
      and(
        eq(certItems.teacherId, teacherId),
        sql`${certExamAttempts.status} IN ('submitted','reviewed')`,
        sql`${certExamAnswers.itemId} IS NOT NULL`,
        sql`${certExamAnswers.taskNumber} > 40`,
        sql`${certExamAnswers.awardedPoints} IS NOT NULL`,
      ),
    );

  const out: PolytomousResponse[] = [];
  for (const r of rows) {
    if (r.itemId === null || r.awardedPoints === null) continue;
    out.push({
      personId: r.attemptId,
      itemId: r.itemId,
      category: bandPoints(r.awardedPoints, maxPointsFor(r.taskNumber)),
    });
  }
  return out;
}

export type CalibrationRunSummary = {
  run_id: number | null;
  run_at: string | null;
  persons: number;
  items: number;
  iterations: number;
  converged: boolean;
  /** Responses that went in, before the extreme-score screen removed any. */
  responses: number;
  excluded_items: number;
  excluded_persons: number;
};

/** Runs the calibration and stores it as a new snapshot. */
export async function runCalibration(teacherId: number): Promise<CalibrationRunSummary> {
  const responses = await collectResponses(teacherId);
  const result = calibrate(responses);

  if (result.items.length === 0) {
    // Nothing placeable — recorded as a run all the same, so the teacher sees
    // that the attempt happened and why it produced nothing.
    return {
      run_id: null,
      run_at: null,
      persons: 0,
      items: 0,
      iterations: result.iterations,
      converged: result.converged,
      responses: responses.length,
      excluded_items: result.excludedItems.length,
      excluded_persons: result.excludedPersons.length,
    };
  }

  const [run] = await db
    .insert(certCalibrationRuns)
    .values({
      teacherId,
      persons: result.persons.length,
      items: result.items.length,
      iterations: result.iterations,
      converged: result.converged,
    })
    .returning();

  await db.insert(certItemCalibrations).values(
    result.items.map((i) => ({
      runId: run.id,
      itemId: i.itemId,
      difficulty: i.difficulty,
      standardError: Number.isFinite(i.standardError) ? i.standardError : 99,
      infit: i.infit,
      outfit: i.outfit,
      responses: i.responses,
      thresholds: null,
    })),
  );

  // Задания 41–43 — вторым проходом, по частично-кредитной модели и при
  // ЗАФИКСИРОВАННЫХ способностях из первого прохода. Подготовка ученика уже
  // измерена сорока заданиями, где информации несравнимо больше; позволять
  // трём письменным работам её пересчитывать значило бы дать им вес, которого
  // у них нет. Заодно письменная часть ложится на ту же шкалу, а не на свою.
  const abilities = new Map(result.persons.map((p) => [p.personId, p.ability]));
  const polytomous = await collectPolytomous(teacherId);
  if (polytomous.length > 0 && abilities.size > 0) {
    const written = calibratePartialCredit({ responses: polytomous, abilities });
    if (written.items.length > 0) {
      await db.insert(certItemCalibrations).values(
        written.items.map((i) => ({
          runId: run.id,
          itemId: i.itemId,
          difficulty: i.difficulty,
          standardError: Number.isFinite(i.standardError) ? i.standardError : 99,
          infit: i.infit,
          outfit: i.outfit,
          responses: i.responses,
          thresholds: i.thresholds,
        })),
      );
    }
  }

  return {
    run_id: run.id,
    run_at: run.runAt.toISOString(),
    persons: result.persons.length,
    items: result.items.length,
    iterations: result.iterations,
    converged: result.converged,
    responses: responses.length,
    excluded_items: result.excludedItems.length,
    excluded_persons: result.excludedPersons.length,
  };
}

export type ItemCalibration = {
  difficulty: number;
  standard_error: number;
  infit: number;
  outfit: number;
  responses: number;
  /** Только у заданий 41–43: ступени частично-кредитной модели. */
  thresholds: number[] | null;
};

/**
 * The latest calibration per item, already filtered by the data threshold —
 * items with too few responses are simply absent from the map rather than
 * present with a number nobody should trust.
 */
export async function latestCalibrationByItem(
  teacherId: number,
): Promise<Map<number, ItemCalibration>> {
  const [run] = await db
    .select()
    .from(certCalibrationRuns)
    .where(eq(certCalibrationRuns.teacherId, teacherId))
    .orderBy(desc(certCalibrationRuns.runAt))
    .limit(1);
  if (!run) return new Map();

  const rows = await db
    .select()
    .from(certItemCalibrations)
    .where(eq(certItemCalibrations.runId, run.id));

  const out = new Map<number, ItemCalibration>();
  for (const r of rows) {
    if (calibrationState(r.responses) === "none") continue;
    out.set(r.itemId, {
      difficulty: r.difficulty,
      standard_error: r.standardError,
      infit: r.infit,
      outfit: r.outfit,
      responses: r.responses,
      thresholds: r.thresholds,
    });
  }
  return out;
}

/**
 * Response counts per item, so the UI can say how far off the threshold is.
 * Считает оба вида ответов: у заданий 41–43 своя, частично-кредитная ветка, и
 * без неё они выглядели бы как «ноль ответов» при готовой калибровке.
 */
export async function responseCountByItem(teacherId: number): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  for (const r of await collectResponses(teacherId)) {
    counts.set(r.itemId, (counts.get(r.itemId) ?? 0) + 1);
  }
  for (const r of await collectPolytomous(teacherId)) {
    counts.set(r.itemId, (counts.get(r.itemId) ?? 0) + 1);
  }
  return counts;
}

export async function latestRun(teacherId: number): Promise<CalibrationRunSummary | null> {
  const [run] = await db
    .select()
    .from(certCalibrationRuns)
    .where(eq(certCalibrationRuns.teacherId, teacherId))
    .orderBy(desc(certCalibrationRuns.runAt))
    .limit(1);
  if (!run) return null;

  const [{ responses }] = await db
    .select({ responses: sql<number>`coalesce(sum(${certItemCalibrations.responses}), 0)::int` })
    .from(certItemCalibrations)
    .where(eq(certItemCalibrations.runId, run.id));

  return {
    run_id: run.id,
    run_at: run.runAt.toISOString(),
    persons: run.persons,
    items: run.items,
    iterations: run.iterations,
    converged: run.converged,
    responses,
    excluded_items: 0,
    excluded_persons: 0,
  };
}
