/**
 * Rasch (one-parameter IRT) calibration of the question bank.
 *
 * The model says one thing: the chance of a correct answer depends only on how
 * far the person's ability sits above the item's difficulty, both measured in
 * the same unit (logits).
 *
 *     P(correct) = 1 / (1 + exp(-(θ − b)))
 *
 * Why this and not more classical statistics: p-value and the discrimination
 * index in certExam.ts are computed WITHIN one variant, because they rank
 * students by their score on that variant. Two questions from two different
 * variants therefore cannot be compared — the harder variant makes its
 * questions look harder. Rasch puts every question on one shared scale, and
 * anchor items carry that scale from one variant to the next.
 *
 * Estimation is JMLE (joint maximum likelihood): abilities and difficulties
 * are refined against each other until neither moves. Chosen over marginal
 * likelihood because it assumes nothing about how abilities are distributed —
 * a real class is not a normal sample — and because every step is inspectable,
 * which matters for a number a teacher will use to retire a question.
 */

export type RaschResponse = {
  personId: number;
  itemId: number;
  correct: boolean;
};

export type RaschItemEstimate = {
  itemId: number;
  /** Difficulty in logits. Higher = harder. */
  difficulty: number;
  standardError: number;
  responses: number;
  /** Information-weighted mean square. Robust to the odd freak answer. */
  infit: number;
  /** Unweighted mean square. Sensitive to surprises — a strong student
   *  failing an easy item moves this and not infit. */
  outfit: number;
};

export type RaschPersonEstimate = {
  personId: number;
  ability: number;
  standardError: number;
  responses: number;
};

export type ExclusionReason =
  | "all_correct"
  | "all_wrong"
  | "no_responses";

export type RaschResult = {
  items: RaschItemEstimate[];
  persons: RaschPersonEstimate[];
  excludedItems: { itemId: number; reason: ExclusionReason }[];
  excludedPersons: { personId: number; reason: ExclusionReason }[];
  iterations: number;
  converged: boolean;
};

export type CalibrateOptions = {
  /**
   * Known difficulties to hold fixed, keyed by item id. This is what anchor
   * items are for: a new variant calibrated against them lands on the
   * existing scale instead of defining its own origin.
   */
  anchors?: Map<number, number>;
  maxIterations?: number;
  /** Largest change in logits that still counts as settled. */
  convergence?: number;
};

const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_CONVERGENCE = 0.001;

/** Keeps Newton–Raphson from taking a wild step on a near-flat gradient. */
const MAX_STEP = 1.0;

function probability(ability: number, difficulty: number): number {
  return 1 / (1 + Math.exp(-(ability - difficulty)));
}

/**
 * Drops rows and columns the model cannot place.
 *
 * A person who answered everything correctly has no upper bound on ability —
 * the likelihood keeps rising forever — and the same is true of an item nobody
 * solved. They are not errors, they simply carry no information about WHERE on
 * the scale they sit, so they are reported separately rather than forced to a
 * number. Removal repeats because dropping one can make another extreme.
 */
function removeExtremes(responses: RaschResponse[]): {
  kept: RaschResponse[];
  excludedItems: { itemId: number; reason: ExclusionReason }[];
  excludedPersons: { personId: number; reason: ExclusionReason }[];
} {
  let current = responses;
  const excludedItems: { itemId: number; reason: ExclusionReason }[] = [];
  const excludedPersons: { personId: number; reason: ExclusionReason }[] = [];

  for (;;) {
    const byItem = new Map<number, { n: number; correct: number }>();
    const byPerson = new Map<number, { n: number; correct: number }>();

    for (const r of current) {
      const i = byItem.get(r.itemId) ?? { n: 0, correct: 0 };
      i.n += 1;
      if (r.correct) i.correct += 1;
      byItem.set(r.itemId, i);

      const p = byPerson.get(r.personId) ?? { n: 0, correct: 0 };
      p.n += 1;
      if (r.correct) p.correct += 1;
      byPerson.set(r.personId, p);
    }

    const dropItems = new Set<number>();
    for (const [itemId, s] of byItem) {
      if (s.correct === 0) {
        dropItems.add(itemId);
        excludedItems.push({ itemId, reason: "all_wrong" });
      } else if (s.correct === s.n) {
        dropItems.add(itemId);
        excludedItems.push({ itemId, reason: "all_correct" });
      }
    }

    const dropPersons = new Set<number>();
    for (const [personId, s] of byPerson) {
      if (s.correct === 0) {
        dropPersons.add(personId);
        excludedPersons.push({ personId, reason: "all_wrong" });
      } else if (s.correct === s.n) {
        dropPersons.add(personId);
        excludedPersons.push({ personId, reason: "all_correct" });
      }
    }

    if (dropItems.size === 0 && dropPersons.size === 0) {
      return { kept: current, excludedItems, excludedPersons };
    }
    current = current.filter((r) => !dropItems.has(r.itemId) && !dropPersons.has(r.personId));
    if (current.length === 0) {
      return { kept: [], excludedItems, excludedPersons };
    }
  }
}

export function calibrate(
  responses: RaschResponse[],
  options: CalibrateOptions = {},
): RaschResult {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const convergence = options.convergence ?? DEFAULT_CONVERGENCE;
  const anchors = options.anchors ?? new Map<number, number>();

  const empty: RaschResult = {
    items: [],
    persons: [],
    excludedItems: [],
    excludedPersons: [],
    iterations: 0,
    converged: true,
  };
  if (responses.length === 0) return empty;

  const { kept, excludedItems, excludedPersons } = removeExtremes(responses);
  if (kept.length === 0) {
    return { ...empty, excludedItems, excludedPersons };
  }

  const itemIds = [...new Set(kept.map((r) => r.itemId))].sort((a, b) => a - b);
  const personIds = [...new Set(kept.map((r) => r.personId))].sort((a, b) => a - b);
  const itemIndex = new Map(itemIds.map((id, i) => [id, i]));
  const personIndex = new Map(personIds.map((id, i) => [id, i]));

  // Sparse by design: a person answers one variant, not the whole bank.
  const cells = kept.map((r) => ({
    p: personIndex.get(r.personId)!,
    i: itemIndex.get(r.itemId)!,
    x: r.correct ? 1 : 0,
  }));

  const itemCorrect = new Array(itemIds.length).fill(0);
  const itemCount = new Array(itemIds.length).fill(0);
  const personCorrect = new Array(personIds.length).fill(0);
  const personCount = new Array(personIds.length).fill(0);
  for (const c of cells) {
    itemCount[c.i] += 1;
    itemCorrect[c.i] += c.x;
    personCount[c.p] += 1;
    personCorrect[c.p] += c.x;
  }

  // Starting values from observed proportions — close enough that Newton
  // needs only a handful of passes.
  const difficulty = itemIds.map((id, i) => {
    const fixed = anchors.get(id);
    if (fixed !== undefined) return fixed;
    const p = itemCorrect[i] / itemCount[i];
    return Math.log((1 - p) / p);
  });
  const ability = personIds.map((_, p) => {
    const share = personCorrect[p] / personCount[p];
    return Math.log(share / (1 - share));
  });

  const anchored = new Set(
    itemIds.map((id, i) => (anchors.has(id) ? i : -1)).filter((i) => i >= 0),
  );

  let iterations = 0;
  let converged = false;

  for (; iterations < maxIterations; iterations++) {
    let maxChange = 0;

    // --- items ---
    const itemNumer = new Array(itemIds.length).fill(0);
    const itemDenom = new Array(itemIds.length).fill(0);
    for (const c of cells) {
      const P = probability(ability[c.p], difficulty[c.i]);
      itemNumer[c.i] += c.x - P;
      itemDenom[c.i] += P * (1 - P);
    }
    for (let i = 0; i < difficulty.length; i++) {
      if (anchored.has(i) || itemDenom[i] <= 0) continue;
      // Difficulty moves OPPOSITE to the residual: more correct answers than
      // the model expects means the item is easier than currently estimated,
      // so its difficulty must come down. (The person update below has the
      // other sign — that asymmetry is the whole of the derivative.)
      const step = clampStep(itemNumer[i] / itemDenom[i]);
      difficulty[i] -= step;
      maxChange = Math.max(maxChange, Math.abs(step));
    }

    // The scale has no natural origin: adding a constant to every ability and
    // every difficulty leaves all probabilities unchanged. Centring the
    // difficulties at zero fixes it — unless anchors already did.
    if (anchored.size === 0) {
      const mean = difficulty.reduce((s, d) => s + d, 0) / difficulty.length;
      for (let i = 0; i < difficulty.length; i++) difficulty[i] -= mean;
    }

    // --- persons ---
    const personNumer = new Array(personIds.length).fill(0);
    const personDenom = new Array(personIds.length).fill(0);
    for (const c of cells) {
      const P = probability(ability[c.p], difficulty[c.i]);
      personNumer[c.p] += c.x - P;
      personDenom[c.p] += P * (1 - P);
    }
    for (let p = 0; p < ability.length; p++) {
      if (personDenom[p] <= 0) continue;
      const step = clampStep(personNumer[p] / personDenom[p]);
      ability[p] += step;
      maxChange = Math.max(maxChange, Math.abs(step));
    }

    if (maxChange < convergence) {
      converged = true;
      iterations += 1;
      break;
    }
  }

  // JMLE inflates the spread of estimates, because each estimate is measured
  // against other estimates that carry their own error. The classic Wright
  // correction shrinks difficulties by (L−1)/L, L being the test length.
  // Skipped when anchors are in play: they define the scale, and shrinking
  // toward zero would pull the new items off it.
  const testLength = itemIds.length;
  if (anchored.size === 0 && testLength > 1) {
    const factor = (testLength - 1) / testLength;
    for (let i = 0; i < difficulty.length; i++) difficulty[i] *= factor;
  }

  // --- standard errors and fit, from the settled estimates ---
  const infoItem = new Array(itemIds.length).fill(0);
  const infoPerson = new Array(personIds.length).fill(0);
  const outfitSum = new Array(itemIds.length).fill(0);
  const infitNumer = new Array(itemIds.length).fill(0);

  for (const c of cells) {
    const P = probability(ability[c.p], difficulty[c.i]);
    const variance = P * (1 - P);
    const residual = c.x - P;

    infoItem[c.i] += variance;
    infoPerson[c.p] += variance;

    // Standardised residual squared, i.e. how surprised the model is here.
    if (variance > 0) outfitSum[c.i] += (residual * residual) / variance;
    infitNumer[c.i] += residual * residual;
  }

  const items: RaschItemEstimate[] = itemIds.map((id, i) => ({
    itemId: id,
    difficulty: round4(difficulty[i]),
    standardError: infoItem[i] > 0 ? round4(1 / Math.sqrt(infoItem[i])) : Number.POSITIVE_INFINITY,
    responses: itemCount[i],
    infit: infoItem[i] > 0 ? round4(infitNumer[i] / infoItem[i]) : 1,
    outfit: itemCount[i] > 0 ? round4(outfitSum[i] / itemCount[i]) : 1,
  }));

  const persons: RaschPersonEstimate[] = personIds.map((id, p) => ({
    personId: id,
    ability: round4(ability[p]),
    standardError:
      infoPerson[p] > 0 ? round4(1 / Math.sqrt(infoPerson[p])) : Number.POSITIVE_INFINITY,
    responses: personCount[p],
  }));

  return { items, persons, excludedItems, excludedPersons, iterations, converged };
}

function clampStep(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.max(-MAX_STEP, Math.min(MAX_STEP, step));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------
// How much data is enough, and how to read the fit numbers
// ---------------------------------------------------------------------

/**
 * Below this many responses an item's difficulty is not worth reporting.
 *
 * Same reasoning as MIN_ATTEMPTS_FOR_DISCRIMINATION in certExam.ts, and the
 * arithmetic is harsher here: with n responses an item can only take n−1
 * distinct finite difficulties. At n = 4 the whole bank collapses onto three
 * values (±1.10 and 0) with a standard error near ±1.15 — wider than the gaps
 * between them. A number like that is not a weak measurement, it is noise
 * wearing a decimal point, and a teacher would retire perfectly good
 * questions on the strength of it.
 */
export const MIN_RESPONSES_PROVISIONAL = 30;

/** Above this the estimate is steady enough to act on without hedging. */
export const MIN_RESPONSES_STABLE = 100;

export type CalibrationState = "none" | "provisional" | "stable";

export function calibrationState(responses: number): CalibrationState {
  if (responses >= MIN_RESPONSES_STABLE) return "stable";
  if (responses >= MIN_RESPONSES_PROVISIONAL) return "provisional";
  return "none";
}

export type FitBand = "overfit" | "productive" | "underfit" | "degrading";

/**
 * Mean-square fit reads as a ratio of observed to expected noise: 1.0 is
 * exactly as unpredictable as the model expects.
 *
 * Above 1.5 the item behaves erratically — strong students miss it, weak ones
 * get it — which in practice means an ambiguous stem or a wrong key. Past 2.0
 * it degrades the measurement rather than merely failing to help.
 *
 * Below 0.5 is the opposite and far less urgent: the item is TOO predictable,
 * telling you what other items already said. Worth knowing when trimming a
 * variant, never a reason to fix anything.
 */
export function fitBand(meanSquare: number): FitBand {
  if (meanSquare > 2.0) return "degrading";
  if (meanSquare > 1.5) return "underfit";
  if (meanSquare < 0.5) return "overfit";
  return "productive";
}
