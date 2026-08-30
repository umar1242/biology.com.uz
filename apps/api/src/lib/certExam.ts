/**
 * Structure of a Milliy Sertifikat biology variant, straight from the
 * official specification (docs/Biologiya-MS2025.pdf, §IV and §VIII):
 *
 *   1–32  Y1  closed, one correct option A–D
 *   33–35 Y2  closed, ONE shared stem, options A–F shared across all three
 *   36–40 O1  open, short answer  — submitted as a photo, graded by hand
 *   41–43 O2  open, extended written solution — photo, graded by hand
 *
 * Scoring: the spec grades 1–40 with a Rasch (IRT) model, which needs
 * response statistics from a large cohort and is meaningless for a single
 * class, so this platform scores 1 point per correct closed answer and
 * 1 point per accepted short answer instead. 41–43 keep the spec's own
 * weights (30/35/10 = 75), because those are absolute, not cohort-relative.
 */

export const CERT_TASK_MIN = 1;
export const CERT_TASK_MAX = 43;
export const CERT_CLOSED_MAX = 35; // last task answered by picking an option

export type CertTaskKind = "closed_ad" | "closed_af" | "open_short" | "open_extended";

const OPTIONS_AD = ["A", "B", "C", "D"] as const;
const OPTIONS_AF = ["A", "B", "C", "D", "E", "F"] as const;

/** Spec §VIII.2: 41 → 30 points, 42 → 35, 43 → 10. */
const EXTENDED_MAX_POINTS: Record<number, number> = { 41: 30, 42: 35, 43: 10 };

export function isValidTaskNumber(n: number): boolean {
  return Number.isInteger(n) && n >= CERT_TASK_MIN && n <= CERT_TASK_MAX;
}

export function taskKind(n: number): CertTaskKind {
  if (n <= 32) return "closed_ad";
  if (n <= 35) return "closed_af";
  if (n <= 40) return "open_short";
  return "open_extended";
}

/** Options a student may pick for a closed task; empty for open tasks. */
export function optionsFor(n: number): readonly string[] {
  const kind = taskKind(n);
  if (kind === "closed_ad") return OPTIONS_AD;
  if (kind === "closed_af") return OPTIONS_AF;
  return [];
}

export function isClosedTask(n: number): boolean {
  return n <= CERT_CLOSED_MAX;
}

/** Maximum points a single task can earn. */
export function maxPointsFor(n: number): number {
  return taskKind(n) === "open_extended" ? EXTENDED_MAX_POINTS[n] : 1;
}

/** Task numbers 1..43 in order. */
export const ALL_TASK_NUMBERS: number[] = Array.from(
  { length: CERT_TASK_MAX },
  (_, i) => i + 1,
);

/** Tasks the teacher supplies an answer key for (1–35). */
export const KEY_TASK_NUMBERS: number[] = ALL_TASK_NUMBERS.filter(isClosedTask);

/** Tasks a student answers with a photo (36–43). */
export const PHOTO_TASK_NUMBERS: number[] = ALL_TASK_NUMBERS.filter((n) => !isClosedTask(n));

/** 35 closed + 5 short + 75 extended = 115. */
export const TOTAL_MAX_POINTS = ALL_TASK_NUMBERS.reduce((sum, n) => sum + maxPointsFor(n), 0);

/** Max points reachable without the teacher's manual review (tasks 1–35). */
export const AUTO_MAX_POINTS = KEY_TASK_NUMBERS.length;

/**
 * Topic per task number, straight from the specification's §IV table, which
 * fixes which section each position tests (e.g. 2–11 are always cell
 * biology, 33–35 always the logic block). That mapping is what lets the
 * platform tag a question's topic without asking the teacher to do it.
 * Codes, not labels — the two frontends render them in ru/uz.
 */
export type CertTopic =
  | "life_science"
  | "cell"
  | "systematics"
  | "plants_animals"
  | "human"
  | "species_population"
  | "ecosystem"
  | "logic"
  | "general_bio";

export function topicFor(n: number): CertTopic {
  if (n === 1) return "life_science";
  if (n <= 11) return "cell";
  if (n === 12) return "systematics";
  if (n <= 19) return "plants_animals";
  if (n <= 23) return "human";
  if (n <= 28) return "species_population";
  if (n <= 32) return "ecosystem";
  if (n <= 35) return "logic";
  return "general_bio";
}

/**
 * How many questions a new variant should carry over from earlier ones.
 *
 * Calibration fixes a scale only *within* one variant (its origin is set by
 * that variant's own mean difficulty), so abilities measured on two
 * unlinked variants are not comparable — a student's progress would be
 * indistinguishable from the two variants differing in difficulty. Shared
 * "anchor" questions, whose difficulty is already known, tie the scales
 * together. The usual guidance is ~20% of the test; for 40 scored tasks
 * that is 8. Advisory, never enforced: a deliberately all-new variant is a
 * legitimate choice, it just cannot be linked to the others.
 */
export const RECOMMENDED_ANCHOR_COUNT = 8;

/**
 * Discrimination index D — how much better the strong half of a group does
 * on a question than the weak half. Kelley's classic upper/lower 27% split:
 * D = share correct among the top 27% − share among the bottom 27%.
 *
 * Chosen over the point-biserial correlation because it says something a
 * teacher can act on directly ("the strong solve it 40% more often"), and
 * because it is the exact quantity that separates two questions with an
 * identical share correct: one that sorts students and one that is a
 * coin flip.
 *
 * A NEGATIVE D means weak students outperform strong ones — nearly always a
 * wrong key or an ambiguous question, and a signal independent of the
 * most-chosen-option check.
 */
export const DISCRIMINATION_GROUP_SHARE = 0.27;

/**
 * Below this many graded attempts in one variant, D is noise wearing a
 * number's clothes. With g examinees per group its standard error is about
 * sqrt(2·p(1−p)/g): at 10 attempts the groups hold 3 people, the scale moves
 * in steps of 0.33 and the error is ±0.4 — wider than the entire useful
 * range, so a perfectly ordinary question drifts negative and gets accused
 * of having a broken key. At 30 the error is ±0.25, at the 100–150 a whole
 * group actually produces it is ±0.11.
 */
export const MIN_ATTEMPTS_FOR_DISCRIMINATION = 30;

export type DiscriminationBand = "good" | "ok" | "weak" | "broken";

/**
 * "broken" is a strong accusation — it tells the teacher the key is probably
 * wrong — so it needs a reversal clearly past the noise floor, not merely a
 * negative sign. Everything between that and 0.2 is "weak": the question
 * does not sort students, which is worth knowing but is not an error.
 */
const BROKEN_BELOW = -0.15;

export function discriminationBand(d: number): DiscriminationBand {
  if (d < BROKEN_BELOW) return "broken";
  if (d < 0.2) return "weak";
  if (d < 0.35) return "ok";
  return "good";
}

/**
 * The specification's own type codes (§III): Y1 closed with one answer,
 * Y2 closed matching, O1 open short answer, O2 open extended written work.
 * Derived from the position, because the spec fixes which type sits where.
 */
export type CertTaskType = "Y1" | "Y2" | "O1" | "O2";

export function taskTypeFor(n: number): CertTaskType {
  if (n <= 32) return "Y1";
  if (n <= 35) return "Y2";
  if (n <= 40) return "O1";
  return "O2";
}

/**
 * A distractor nobody picks is not doing any work: the question is
 * effectively a 3-choice item, which raises the odds of a lucky guess from
 * 25% to 33%. Worth flagging so the option can be rewritten.
 */
export const DEAD_DISTRACTOR_SHARE = 0.05;

/** Human-readable item code shown on the card and cited in discussion. */
export function itemCode(id: number, taskNumber: number): string {
  return `${taskNumber}-${String(id).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------
// Final score, in the shape the national certificate actually reports.
// ---------------------------------------------------------------------

/**
 * The real certificate carries three numbers: a test result, a written-work
 * result, and a total that is their plain arithmetic mean — verified against
 * an issued certificate (46.71 and 48.62 → 47.67), with the grade band
 * matching the agency's published table.
 *
 * So the written half — three tasks — weighs exactly as much as the forty
 * test tasks. Scoring an attempt out of a flat 115 points hides that: it
 * gives the written part 65% of the weight instead of 50%, which reorders
 * students against how the real exam would rank them.
 */

/** Score reported as 100%. Above it the percentage caps but the grade rises. */
export const CERT_SCALE_REFERENCE = 65;

/** Tasks 1–40: closed plus short-answer, one point each on this platform. */
export const TEST_HALF_TASK_COUNT = 40;

/** Tasks 41–43, the written work: 30 + 35 + 10 (spec §VIII.2). */
export const WRITTEN_HALF_MAX_POINTS = 75;

export type CertGrade = "A+" | "A" | "B+" | "B" | "C+" | "C";

/**
 * Grade bands as published by the assessment agency. Returns null below 46 —
 * no certificate is issued at all, which is a different statement from "a low
 * grade" and the UI must not blur the two.
 *
 * The published bands leave a hairline gap: A ends at 69.9 and A+ starts
 * "above 70". Exactly 70.0 is read here as A, the conservative side.
 */
export function certGrade(score: number): CertGrade | null {
  if (score > 70) return "A+";
  if (score >= 65) return "A";
  if (score >= 60) return "B+";
  if (score >= 55) return "B";
  if (score >= 50) return "C+";
  if (score >= 46) return "C";
  return null;
}

export type CertScoreEstimate = {
  /** Test half (tasks 1–40) on the national scale. */
  test: number;
  /** Written half (tasks 41–43) on the national scale. */
  written: number;
  /** Their mean — what the certificate calls "umumiy to'plagan ball". */
  total: number;
  /** total / 65, capped at 100 exactly as the certificate does. */
  percent: number;
  grade: CertGrade | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Estimates where an attempt would land on the certificate scale.
 *
 * Deliberately an ESTIMATE, and callers must present it as one: the real test
 * half is scored with a Rasch model, where a correct answer to a hard task is
 * worth more than to an easy one and difficulty comes from a nationwide
 * cohort. Here it is a plain share of correct answers, so two students who
 * solved the same NUMBER of tasks score identically even when one solved the
 * harder ones. A+ is unreachable by construction: it means the model placed a
 * student above the reference point, which a share of correct answers cannot
 * express.
 */
export function estimateCertScore(params: {
  /** Correct answers among tasks 1–40. */
  testCorrect: number;
  /** Points awarded for tasks 41–43. */
  writtenPoints: number;
}): CertScoreEstimate {
  const testFraction = clampFraction(params.testCorrect / TEST_HALF_TASK_COUNT);
  const writtenFraction = clampFraction(params.writtenPoints / WRITTEN_HALF_MAX_POINTS);

  const test = testFraction * CERT_SCALE_REFERENCE;
  const written = writtenFraction * CERT_SCALE_REFERENCE;
  const total = (test + written) / 2;

  return {
    test: round2(test),
    written: round2(written),
    total: round2(total),
    percent: round2(Math.min(total / CERT_SCALE_REFERENCE, 1) * 100),
    grade: certGrade(total),
  };
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value > 1 ? 1 : value;
}

/**
 * Splits graded answers into the two halves the certificate reports.
 *
 * Needed because the platform stores one `manualScore` covering tasks 36–43,
 * while the certificate draws its line between 40 and 41: short answers count
 * toward the test half, only the extended written work forms the other.
 */
export function splitHalves(
  answers: { taskNumber: number; isCorrect?: boolean | null; awardedPoints?: number | null }[],
): { testCorrect: number; writtenPoints: number } {
  let testCorrect = 0;
  let writtenPoints = 0;

  for (const a of answers) {
    if (!isValidTaskNumber(a.taskNumber)) continue;
    if (isClosedTask(a.taskNumber)) {
      if (a.isCorrect) testCorrect += 1;
    } else if (taskKind(a.taskNumber) === "open_short") {
      // Short answers are worth one point, same as a closed task.
      if ((a.awardedPoints ?? 0) > 0) testCorrect += 1;
    } else {
      writtenPoints += a.awardedPoints ?? 0;
    }
  }

  return { testCorrect, writtenPoints };
}

// ---------------------------------------------------------------------
// Открытые задания: ручная проверка или ввод ответа с клавиатуры
// ---------------------------------------------------------------------
//
// Спецификация не запрещает проверять 36–43 автоматически: она лишь не
// делает этого сама. Если у задания есть однозначный короткий ответ
// («митохондрия», «0.5»), фотография тетради и ручная проверка — лишний
// круг для всех. Режим выбирает преподаватель, и он же остаётся хозяином:
// по умолчанию проверка ручная, автоматическая включается явно.

export type GradingMode = "manual" | "typed";

/** До скольких частей может состоять набранный ответ. */
export const MAX_ANSWER_PARTS = 6;

/**
 * Сколько частей допустимо у задания. У 36–40 ответ один по определению
 * («краткий ответ»), у 41–43 развёрнутое решение может разбиваться на
 * несколько пунктов — их число задаёт преподаватель.
 */
export function maxPartsFor(taskNumber: number): number {
  const kind = taskKind(taskNumber);
  if (kind === "open_short") return 1;
  if (kind === "open_extended") return MAX_ANSWER_PARTS;
  return 0;
}

/**
 * Делит баллы задания между частями поровну, остаток отдаёт первым.
 * 35 на три части — это 12, 12 и 11, а не 11,67 у каждой: баллы целые,
 * и терять единицу при делении нельзя.
 */
export function splitPoints(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Приводит ответ к виду, в котором его можно сравнивать.
 *
 * Что здесь считается несущественным и почему:
 *   регистр и лишние пробелы  — ученик набирает с телефона;
 *   ё против е                — на многих клавиатурах ё просто нет;
 *   апострофы в o' и g'       — узбекская латиница набирается пятью
 *                               разными знаками, и все они одно и то же;
 *   запятая в числе           — 0,5 и 0.5 это одно число;
 *   точка в конце             — «митохондрия.» не другой ответ.
 */
export function normalizeAnswer(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[‘’ʻʼ`´]/g, "'")
    .replace(/(\d)[,](\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!]+$/, "");
}

/**
 * Совпал ли ответ хотя бы с одним допустимым вариантом. Синонимы задаёт
 * преподаватель: автоматическая проверка не должна угадывать, что
 * «митохондрии» это тоже верно, — она должна об этом знать.
 */
export function matchesAnswerKey(given: string, accepted: readonly string[]): boolean {
  const normalized = normalizeAnswer(given);
  if (!normalized) return false;
  return accepted.some((variant) => normalizeAnswer(variant) === normalized);
}

/**
 * Баллы за набранный ответ: по части за каждую угаданную. Возвращает и
 * вердикт по частям — он замораживается на строке ответа, чтобы поздняя
 * правка ключа не переписала уже сданную работу.
 */
export function gradeTypedAnswer(params: {
  taskNumber: number;
  given: readonly (string | null)[];
  key: readonly (readonly string[])[];
}): { partCorrect: boolean[]; awardedPoints: number } {
  const points = splitPoints(maxPointsFor(params.taskNumber), params.key.length);
  const partCorrect = params.key.map((accepted, i) => {
    const given = params.given[i];
    return typeof given === "string" && matchesAnswerKey(given, accepted);
  });
  const awardedPoints = partCorrect.reduce((sum, ok, i) => sum + (ok ? points[i] : 0), 0);
  return { partCorrect, awardedPoints };
}
