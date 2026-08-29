import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  certCalibrationRuns,
  certExamAnswers,
  certExamAttempts,
  certItemCalibrations,
  certItems,
} from "../db/schema.js";
import { isClosedTask } from "./certExam.js";
import { calibrate, calibrationState, type RaschResponse } from "./rasch.js";

/**
 * Collects every graded answer belonging to one teacher into a single response
 * matrix — pointedly NOT split by variant, unlike discriminationByItem() in
 * routes/certExams.ts, which has to rank students within one exam.
 *
 * Pooling is what makes difficulties comparable across variants, and it is
 * legitimate here only because items keep their identity in the bank: the same
 * question asked in two variants is the same column.
 */
async function collectResponses(teacherId: number): Promise<RaschResponse[]> {
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
    })),
  );

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
    });
  }
  return out;
}

/** Response counts per item, so the UI can say how far off the threshold is. */
export async function responseCountByItem(teacherId: number): Promise<Map<number, number>> {
  const responses = await collectResponses(teacherId);
  const counts = new Map<number, number>();
  for (const r of responses) counts.set(r.itemId, (counts.get(r.itemId) ?? 0) + 1);
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
