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
