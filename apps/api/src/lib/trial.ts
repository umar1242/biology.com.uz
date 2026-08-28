/**
 * Trial-period arithmetic, kept separate from the sweep job so the rule is
 * unit-testable without a database (see trial.test.ts).
 *
 * The trial is measured in published lessons rather than days: Telegram gives
 * no way to know who actually attended a live lesson, so "how much of the
 * course has gone by since you signed up" is the closest honest proxy.
 */

/**
 * Counts only lessons published strictly after the student joined — lessons
 * that were already out when they applied are course back-catalogue, not part
 * of what their trial buys them.
 */
export function lessonsConsumedSince(
  publishedAt: (Date | null)[],
  trialStartedAt: Date,
): number {
  return publishedAt.filter((d) => d !== null && d.getTime() > trialStartedAt.getTime()).length;
}

/**
 * The trial is spent once MORE lessons than the allowance have appeared: with
 * an allowance of 2, lessons 1 and 2 are free and the freeze fires when the
 * third is published. An allowance of 0 means the freeze fires on the first
 * lesson — i.e. no free lessons at all.
 */
export function isTrialExhausted(lessonsConsumed: number, trialLessonCount: number): boolean {
  return lessonsConsumed > trialLessonCount;
}
