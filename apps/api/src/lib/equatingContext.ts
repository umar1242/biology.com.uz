/**
 * Собирает всё, что нужно для поправки на трудность варианта: трудности
 * заданий каждого варианта и то, связаны ли варианты между собой.
 *
 * Связность здесь — не формальность. Трудности всех вариантов приходят из
 * одной калибровки и лежат на одной шкале только потому, что варианты сцеплены
 * общими заданиями. Вариант, у которого общих заданий нет ни с кем, получил
 * собственное начало отсчёта, и переводить его результаты в чужую шкалу
 * нельзя — цифра выйдет правдоподобной и неверной.
 *
 * Сцепление работает по цепочке: если C делит задания с B, а B с эталоном A,
 * то C с A связан. Поэтому компоненты считаются объединением множеств, а не
 * прямой проверкой «есть ли общее задание с эталоном».
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  certCalibrationRuns,
  certExamItems,
  certExams,
  certItemCalibrations,
  teachers,
} from "../db/schema.js";
import { calibrationState } from "./rasch.js";
import { DRIFT_MIN_LOGITS, DRIFT_MIN_Z, MIN_STABLE_ANCHORS } from "./anchorDrift.js";

export type ExamEquating = {
  examId: number;
  difficulties: number[];
  linked: boolean;
  /** Сколько откалиброванных заданий у варианта общих непосредственно с эталоном. */
  sharedWithReference: number;
  /** Из них устойчивых — не уехавших между вариантами. */
  stableWithReference: number;
};

export type EquatingContext = {
  referenceExamId: number | null;
  referenceDifficulties: number[];
  byExam: Map<number, ExamEquating>;
};

const EMPTY: EquatingContext = {
  referenceExamId: null,
  referenceDifficulties: [],
  byExam: new Map(),
};

export async function loadEquatingContext(teacherId: number): Promise<EquatingContext> {
  const [run] = await db
    .select()
    .from(certCalibrationRuns)
    .where(eq(certCalibrationRuns.teacherId, teacherId))
    .orderBy(desc(certCalibrationRuns.runAt))
    .limit(1);
  if (!run) return EMPTY;

  const calibrations = await db
    .select()
    .from(certItemCalibrations)
    .where(eq(certItemCalibrations.runId, run.id));

  // Задания ниже порога ответов не участвуют: их трудность платформа не
  // показывает нигде, и опираться на неё в оценке ученика тем более нельзя.
  const difficultyByItem = new Map<number, number>();
  // Уехавшее общее задание перестаёт быть якорем: оно ведёт себя в двух
  // вариантах по-разному, и связь, на нём построенная, кривая. Из счёта
  // связей такое задание выбывает, хотя трудность у него остаётся — она
  // верна для каждого варианта в отдельности.
  const drifted = new Set<number>();
  for (const c of calibrations) {
    if (calibrationState(c.responses) === "none") continue;
    difficultyByItem.set(c.itemId, c.difficulty);
    if (
      c.displacement !== null &&
      c.displacementError !== null &&
      Math.abs(c.displacement) >= DRIFT_MIN_LOGITS &&
      c.displacementError > 0 &&
      Math.abs(c.displacement / c.displacementError) >= DRIFT_MIN_Z
    ) {
      drifted.add(c.itemId);
    }
  }
  if (difficultyByItem.size === 0) return EMPTY;

  const examItems = await db
    .select({ examId: certExamItems.examId, itemId: certExamItems.itemId })
    .from(certExamItems)
    .innerJoin(certExams, eq(certExams.id, certExamItems.examId))
    .where(eq(certExams.teacherId, teacherId));

  const itemsByExam = new Map<number, number[]>();
  for (const r of examItems) {
    if (!difficultyByItem.has(r.itemId)) continue;
    const list = itemsByExam.get(r.examId) ?? [];
    list.push(r.itemId);
    itemsByExam.set(r.examId, list);
  }
  if (itemsByExam.size === 0) return EMPTY;

  // --- связные компоненты по общим заданиям ---------------------------
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const examId of itemsByExam.keys()) parent.set(examId, examId);

  const examsByItem = new Map<number, number[]>();
  for (const [examId, items] of itemsByExam) {
    for (const itemId of items) {
      const list = examsByItem.get(itemId) ?? [];
      list.push(examId);
      examsByItem.set(itemId, list);
    }
  }
  for (const exams of examsByItem.values()) {
    for (let i = 1; i < exams.length; i += 1) union(exams[0], exams[i]);
  }

  // --- эталон ---------------------------------------------------------
  const [teacher] = await db
    .select({ referenceExamId: teachers.certReferenceExamId })
    .from(teachers)
    .where(eq(teachers.staffUserId, teacherId))
    .limit(1);

  const chosen = teacher?.referenceExamId ?? null;
  // Выбор по умолчанию — вариант с наибольшим числом откалиброванных заданий:
  // его шкала опирается на самые надёжные измерения. При равенстве берётся
  // старший по номеру, чтобы эталон не прыгал при добавлении вариантов.
  const fallback = [...itemsByExam.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0] - b[0],
  )[0]?.[0];
  const referenceExamId =
    chosen !== null && itemsByExam.has(chosen) ? chosen : (fallback ?? null);
  if (referenceExamId === null) return EMPTY;

  const referenceItems = itemsByExam.get(referenceExamId) ?? [];
  const referenceSet = new Set(referenceItems);
  const referenceRoot = find(referenceExamId);

  const byExam = new Map<number, ExamEquating>();
  for (const [examId, items] of itemsByExam) {
    const isReference = examId === referenceExamId;
    const shared = isReference ? items : items.filter((id) => referenceSet.has(id));
    const stable = shared.filter((id) => !drifted.has(id));
    // Ниже порога устойчивых якорей связь есть формально, но держится на
    // одном-двух заданиях: удаление ещё одного двинет шкалу сильнее, чем сам
    // дрейф. Такую связь лучше не считать связью вовсе.
    const enough = isReference || stable.length >= MIN_STABLE_ANCHORS;
    byExam.set(examId, {
      examId,
      difficulties: items.map((id) => difficultyByItem.get(id) as number),
      linked: (isReference || find(examId) === referenceRoot) && enough,
      sharedWithReference: shared.length,
      stableWithReference: stable.length,
    });
  }

  return {
    referenceExamId,
    referenceDifficulties: referenceItems.map((id) => difficultyByItem.get(id) as number),
    byExam,
  };
}
