import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calibrate,
  connectedComponents,
  calibrationState,
  fitBand,
  MIN_RESPONSES_PROVISIONAL,
  type RaschResponse,
} from "./rasch.js";

/**
 * Deterministic generator — a seeded LCG rather than Math.random, so a failing
 * run can be reproduced exactly. An estimator tested against a moving target
 * is not tested at all.
 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Draws from the model itself: this is the ground truth we must recover. */
function simulate(
  abilities: number[],
  difficulties: number[],
  rng: () => number,
): RaschResponse[] {
  const out: RaschResponse[] = [];
  for (let p = 0; p < abilities.length; p++) {
    for (let i = 0; i < difficulties.length; i++) {
      const prob = 1 / (1 + Math.exp(-(abilities[p] - difficulties[i])));
      out.push({ personId: p + 1, itemId: i + 1, correct: rng() < prob });
    }
  }
  return out;
}

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

function rmse(a: number[], b: number[]): number {
  const sum = a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  return Math.sqrt(sum / a.length);
}

/** 40 items spread evenly over ±2 logits — a realistic variant. */
function evenDifficulties(count: number): number[] {
  return Array.from({ length: count }, (_, i) => -2 + (4 * i) / (count - 1));
}

/** Abilities from an approximately normal spread, via the CLT on the LCG. */
function normalAbilities(count: number, rng: () => number): number[] {
  return Array.from({ length: count }, () => {
    let sum = 0;
    for (let k = 0; k < 12; k++) sum += rng();
    return sum - 6; // mean 0, sd 1
  });
}

test("recovers the difficulties it was generated from", () => {
  const rng = makeRng(20260829);
  const trueDifficulties = evenDifficulties(40);
  const trueAbilities = normalAbilities(300, rng);

  const result = calibrate(simulate(trueAbilities, trueDifficulties, rng));

  assert.ok(result.converged, "estimation must settle");
  const estimated = result.items
    .slice()
    .sort((a, b) => a.itemId - b.itemId)
    .map((i) => i.difficulty);
  const expected = result.items
    .slice()
    .sort((a, b) => a.itemId - b.itemId)
    .map((i) => trueDifficulties[i.itemId - 1]);

  const r = correlation(estimated, expected);
  const error = rmse(estimated, expected);
  assert.ok(r > 0.95, `correlation with truth was ${r.toFixed(3)}, expected > 0.95`);
  assert.ok(error < 0.3, `RMSE was ${error.toFixed(3)} logits, expected < 0.3`);
});

test("difficulties are centred, fixing the scale's arbitrary origin", () => {
  const rng = makeRng(7);
  const result = calibrate(simulate(normalAbilities(200, rng), evenDifficulties(30), rng));
  const mean = result.items.reduce((s, i) => s + i.difficulty, 0) / result.items.length;
  assert.ok(Math.abs(mean) < 0.05, `mean difficulty was ${mean.toFixed(4)}, expected ~0`);
});

test("recovers abilities too, ordering students correctly", () => {
  const rng = makeRng(99);
  const trueAbilities = normalAbilities(200, rng);
  const result = calibrate(simulate(trueAbilities, evenDifficulties(40), rng));

  const estimated = result.persons.map((p) => p.ability);
  const expected = result.persons.map((p) => trueAbilities[p.personId - 1]);
  const r = correlation(estimated, expected);
  assert.ok(r > 0.9, `ability correlation was ${r.toFixed(3)}, expected > 0.9`);
});

test("a broken item is caught by outfit, well-behaved ones are not", () => {
  const rng = makeRng(4242);
  const trueDifficulties = evenDifficulties(30);
  const trueAbilities = normalAbilities(300, rng);
  const responses = simulate(trueAbilities, trueDifficulties, rng);

  // Item 15 answered by coin flip: ability tells you nothing about it, which
  // is what a wrong key or an ambiguous stem looks like in the data.
  const broken = 15;
  for (const r of responses) {
    if (r.itemId === broken) r.correct = rng() < 0.5;
  }

  const result = calibrate(responses);
  const brokenItem = result.items.find((i) => i.itemId === broken)!;
  assert.ok(
    brokenItem.outfit > 1.5,
    `broken item outfit was ${brokenItem.outfit}, expected > 1.5`,
  );
  assert.equal(fitBand(brokenItem.outfit), "underfit");

  const others = result.items.filter((i) => i.itemId !== broken);
  const misflagged = others.filter((i) => i.outfit > 1.5);
  assert.equal(misflagged.length, 0, "well-behaved items must not be accused");
});

test("extreme persons and items are set aside, not forced to a number", () => {
  const responses: RaschResponse[] = [
    // person 1 solves everything, person 4 solves nothing — no finite ability
    { personId: 1, itemId: 1, correct: true },
    { personId: 1, itemId: 2, correct: true },
    { personId: 1, itemId: 3, correct: true },
    { personId: 2, itemId: 1, correct: true },
    { personId: 2, itemId: 2, correct: false },
    { personId: 2, itemId: 3, correct: true },
    { personId: 3, itemId: 1, correct: true },
    { personId: 3, itemId: 2, correct: false },
    { personId: 3, itemId: 3, correct: false },
    { personId: 4, itemId: 1, correct: false },
    { personId: 4, itemId: 2, correct: false },
    { personId: 4, itemId: 3, correct: false },
  ];

  const result = calibrate(responses);
  const excludedIds = result.excludedPersons.map((p) => p.personId);
  assert.ok(excludedIds.includes(1), "the all-correct person has no upper bound");
  assert.ok(excludedIds.includes(4), "the all-wrong person has no lower bound");
  // Item 1 is then solved by everyone remaining, so it drops out in turn.
  assert.ok(result.excludedItems.some((i) => i.itemId === 1));
  for (const item of result.items) {
    assert.ok(Number.isFinite(item.difficulty), "surviving estimates must be finite");
  }
});

test("anchors carry the scale across variants", () => {
  const rng = makeRng(31337);
  const anchorDifficulties = [-1.5, -0.9, -0.3, 0.2, 0.7, 1.1, 1.6, 2.0];

  // Second variant: the eight anchors (ids 1–8) plus twelve fresh items,
  // taken by a group that is stronger on average than the first.
  const fresh = Array.from({ length: 12 }, (_, i) => -1.2 + i * 0.25);
  const difficulties = [...anchorDifficulties, ...fresh];
  const abilities = normalAbilities(300, rng).map((a) => a + 0.8);

  const anchors = new Map(anchorDifficulties.map((d, i) => [i + 1, d]));
  const result = calibrate(simulate(abilities, difficulties, rng), { anchors });

  for (const [itemId, fixed] of anchors) {
    const estimated = result.items.find((i) => i.itemId === itemId)!;
    assert.equal(estimated.difficulty, fixed, `anchor ${itemId} must not move`);
  }

  // The fresh items must land near their true difficulty ON THE ANCHOR SCALE —
  // this is the whole point: a stronger cohort must not make items look easier.
  const freshEstimates = result.items.filter((i) => i.itemId > 8);
  const error = rmse(
    freshEstimates.map((i) => i.difficulty),
    freshEstimates.map((i) => difficulties[i.itemId - 1]),
  );
  assert.ok(error < 0.4, `fresh items were off by ${error.toFixed(3)} logits on the anchor scale`);
});

test("degenerate input returns nothing rather than NaN", () => {
  assert.deepEqual(calibrate([]).items, []);

  const oneEach = calibrate([{ personId: 1, itemId: 1, correct: true }]);
  assert.equal(oneEach.items.length, 0, "a single response places nobody");

  const allCorrect = calibrate([
    { personId: 1, itemId: 1, correct: true },
    { personId: 2, itemId: 1, correct: true },
  ]);
  assert.equal(allCorrect.items.length, 0);
  assert.ok(allCorrect.excludedItems.length > 0, "and says why");
});

test("estimates are never reported below the data threshold", () => {
  assert.equal(calibrationState(0), "none");
  assert.equal(calibrationState(MIN_RESPONSES_PROVISIONAL - 1), "none");
  assert.equal(calibrationState(MIN_RESPONSES_PROVISIONAL), "provisional");
  assert.equal(calibrationState(99), "provisional");
  assert.equal(calibrationState(100), "stable");
});

test("fit bands name what a teacher should do about them", () => {
  assert.equal(fitBand(1.0), "productive");
  assert.equal(fitBand(0.5), "productive");
  assert.equal(fitBand(1.5), "productive");
  assert.equal(fitBand(0.49), "overfit");
  assert.equal(fitBand(1.6), "underfit");
  assert.equal(fitBand(2.01), "degrading");
});

// --- связность матрицы -------------------------------------------------

test("связный дизайн — один кусок", () => {
  const responses = [
    { personId: 1, itemId: 1, correct: true },
    { personId: 1, itemId: 2, correct: false },
    { personId: 2, itemId: 2, correct: true },
    { personId: 2, itemId: 3, correct: false },
  ];
  assert.equal(connectedComponents(responses).length, 1);
});

test("два варианта без общих заданий и учеников — два куска", () => {
  const responses = [
    { personId: 1, itemId: 1, correct: true },
    { personId: 1, itemId: 2, correct: false },
    { personId: 2, itemId: 1, correct: false },
    { personId: 3, itemId: 8, correct: true },
    { personId: 3, itemId: 9, correct: false },
    { personId: 4, itemId: 9, correct: true },
  ];
  const parts = connectedComponents(responses);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].items, [1, 2]);
  assert.deepEqual(parts[1].items, [8, 9]);
});

test("общее задание связывает варианты", () => {
  const responses = [
    { personId: 1, itemId: 1, correct: true },
    { personId: 1, itemId: 5, correct: false },
    { personId: 2, itemId: 5, correct: true },
    { personId: 2, itemId: 9, correct: false },
  ];
  assert.equal(connectedComponents(responses).length, 1);
});

test("общий ученик связывает варианты не хуже общего задания", () => {
  // Ни одного общего задания, но человек писал оба варианта.
  const responses = [
    { personId: 1, itemId: 1, correct: true },
    { personId: 1, itemId: 2, correct: false },
    { personId: 1, itemId: 8, correct: true },
    { personId: 1, itemId: 9, correct: false },
    { personId: 2, itemId: 1, correct: false },
    { personId: 3, itemId: 8, correct: true },
  ];
  assert.equal(connectedComponents(responses).length, 1);
});

test("несвязный кусок не получает оценок вовсе", () => {
  const rand = makeRng(31);
  const responses: { personId: number; itemId: number; correct: boolean }[] = [];
  // Крупный кусок: 60 человек на заданиях 1..20.
  for (let p = 1; p <= 60; p += 1) {
    const theta = (rand() - 0.5) * 3;
    for (let i = 1; i <= 20; i += 1) {
      responses.push({
        personId: p,
        itemId: i,
        correct: rand() < 1 / (1 + Math.exp(-(theta - (-2 + (4 * i) / 20)))),
      });
    }
  }
  // Отдельный кусок: 30 человек на заданиях 101..110, ни одного пересечения.
  for (let p = 101; p <= 130; p += 1) {
    const theta = (rand() - 0.5) * 3;
    for (let i = 101; i <= 110; i += 1) {
      responses.push({
        personId: p,
        itemId: i,
        correct: rand() < 1 / (1 + Math.exp(-(theta - (-1 + (2 * (i - 100)) / 10)))),
      });
    }
  }

  const result = calibrate(responses);
  assert.equal(result.components, 2);
  assert.ok(result.items.every((i) => i.itemId <= 20), "оценены задания не того куска");
  assert.ok(result.persons.every((p) => p.personId <= 60));
  const dropped = result.excludedItems.filter((e) => e.reason === "disconnected");
  assert.equal(dropped.length, 10);
  assert.ok(dropped.every((e) => e.itemId >= 101));
});
