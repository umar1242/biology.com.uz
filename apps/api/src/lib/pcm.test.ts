import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  bandPoints,
  calibratePartialCredit,
  categoryProbabilities,
  PCM_CATEGORY_COUNT,
} from "./pcm.js";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("вероятности категорий складываются в единицу", () => {
  for (const theta of [-3, -1, 0, 1.5, 4]) {
    const p = categoryProbabilities(theta, [-1, 0, 1]);
    assert.equal(p.length, 4);
    assert.ok(Math.abs(p.reduce((s, v) => s + v, 0) - 1) < 1e-9);
    assert.ok(p.every((v) => v >= 0));
  }
});

test("сильный ученик чаще берёт верхнюю ступень", () => {
  const weak = categoryProbabilities(-2, [-1, 0, 1]);
  const strong = categoryProbabilities(2, [-1, 0, 1]);
  assert.ok(strong[3] > weak[3]);
  assert.ok(strong[0] < weak[0]);
});

test("пороги восстанавливаются по сгенерированным данным", () => {
  const rand = mulberry32(7);
  const truth = new Map([
    [1, [-1.5, -0.5, 0.5, 1.5]],
    [2, [-0.5, 0.5, 1.5, 2.5]],
    [3, [-2.5, -1.5, -0.5, 0.5]],
  ]);

  // Разброс подготовки шире порогов: верхнюю ступень задания с порогом 2.5
  // при N(0,1) берут единицы, и оценить её не из чего — это свойство данных,
  // а не оценщика.
  const abilities = new Map<number, number>();
  const responses: { personId: number; itemId: number; category: number }[] = [];
  for (let p = 1; p <= 1200; p += 1) {
    const u = Math.max(rand(), 1e-9);
    const theta = 1.5 * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    abilities.set(p, theta);
    for (const [itemId, thresholds] of truth) {
      const probabilities = categoryProbabilities(theta, thresholds);
      let roll = rand();
      let category = 0;
      for (let k = 0; k < probabilities.length; k += 1) {
        roll -= probabilities[k];
        if (roll <= 0) {
          category = k;
          break;
        }
      }
      responses.push({ personId: p, itemId, category });
    }
  }

  const result = calibratePartialCredit({ responses, abilities });
  assert.equal(result.items.length, 3);

  for (const item of result.items) {
    const expected = truth.get(item.itemId) as number[];
    assert.equal(item.thresholds.length, expected.length);
    for (let i = 0; i < expected.length; i += 1) {
      assert.ok(
        Math.abs(item.thresholds[i] - expected[i]) < 0.35,
        `задание ${item.itemId}, порог ${i + 1}: ${item.thresholds[i]} против ${expected[i]}`,
      );
    }
    // Трудность задания целиком — среднее порогов.
    const meanTruth = expected.reduce((s, d) => s + d, 0) / expected.length;
    assert.ok(Math.abs(item.difficulty - meanTruth) < 0.3);
    // Данные порождены самой моделью, поэтому соответствие обязано быть в
    // рабочей полосе.
    assert.ok(item.outfit > 0.6 && item.outfit < 1.5, `outfit ${item.outfit}`);
    assert.ok(item.infit > 0.6 && item.infit < 1.5, `infit ${item.infit}`);
  }
});

test("трудность задания растёт вместе с его порогами", () => {
  const rand = mulberry32(11);
  const abilities = new Map<number, number>();
  const responses: { personId: number; itemId: number; category: number }[] = [];
  const truth = new Map([
    [1, [-2, -1, 0]],
    [2, [1, 2, 3]],
  ]);
  for (let p = 1; p <= 300; p += 1) {
    const theta = (rand() - 0.5) * 4;
    abilities.set(p, theta);
    for (const [itemId, thresholds] of truth) {
      const probabilities = categoryProbabilities(theta, thresholds);
      let roll = rand();
      let category = 0;
      for (let k = 0; k < probabilities.length; k += 1) {
        roll -= probabilities[k];
        if (roll <= 0) {
          category = k;
          break;
        }
      }
      responses.push({ personId: p, itemId, category });
    }
  }
  const result = calibratePartialCredit({ responses, abilities });
  const easy = result.items.find((i) => i.itemId === 1) as { difficulty: number };
  const hard = result.items.find((i) => i.itemId === 2) as { difficulty: number };
  assert.ok(hard.difficulty > easy.difficulty + 1.5);
});

test("пустые ступени склеиваются, а не дают бесконечный порог", () => {
  const abilities = new Map([
    [1, -1],
    [2, 0],
    [3, 1],
    [4, 2],
  ]);
  // Ступени 1 и 3 не занял никто.
  const responses = [
    { personId: 1, itemId: 9, category: 0 },
    { personId: 2, itemId: 9, category: 2 },
    { personId: 3, itemId: 9, category: 2 },
    { personId: 4, itemId: 9, category: 4 },
  ];
  const result = calibratePartialCredit({ responses, abilities });
  const item = result.items[0];
  assert.equal(item.categories, 3);
  assert.equal(item.collapsed, true);
  assert.ok(item.thresholds.every((d) => Number.isFinite(d)));
});

test("задание с одним ответом на всех измерять нечем", () => {
  const abilities = new Map([
    [1, 0],
    [2, 1],
  ]);
  const result = calibratePartialCredit({
    responses: [
      { personId: 1, itemId: 5, category: 3 },
      { personId: 2, itemId: 5, category: 3 },
    ],
    abilities,
  });
  assert.equal(result.items.length, 0);
  assert.deepEqual(result.excludedItems, [5]);
});

test("баллы сводятся в пять ступеней", () => {
  assert.equal(bandPoints(0, 30), 0);
  assert.equal(bandPoints(30, 30), PCM_CATEGORY_COUNT - 1);
  assert.equal(bandPoints(15, 30), 2);
  assert.equal(bandPoints(35, 35), 4);
  assert.equal(bandPoints(5, 10), 2);
  // Ступени идут по возрастанию и не проваливаются.
  let previous = -1;
  for (let points = 0; points <= 35; points += 1) {
    const band = bandPoints(points, 35);
    assert.ok(band >= previous);
    previous = band;
  }
});
