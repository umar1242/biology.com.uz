import { strict as assert } from "node:assert";
import { test } from "node:test";
import { analyseDimensionality } from "./dimensionality.js";
import { calibrate } from "./rasch.js";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const P = (theta: number, b: number) => 1 / (1 + Math.exp(-(theta - b)));

/**
 * Генерирует ответы. `split` — доля заданий, которые слушаются ВТОРОЙ
 * способности вместо первой: ноль даёт одномерный тест, половина — тест,
 * в котором намешаны два разных измерения.
 */
function makeData(seed: number, split: number) {
  const rand = mulberry32(seed);
  const normal = (m: number, sd: number) => {
    const u = Math.max(rand(), 1e-9);
    return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };

  const items = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    b: -2 + (4 * i) / 29,
    second: i / 30 < split,
  }));

  const responses: { personId: number; itemId: number; correct: boolean }[] = [];
  for (let p = 1; p <= 200; p += 1) {
    const first = normal(0, 1);
    // Вторая способность независима от первой — именно это и делает тест
    // двумерным.
    const second = normal(0, 1);
    for (const item of items) {
      const theta = item.second ? second : first;
      responses.push({ personId: p, itemId: item.id, correct: rand() < P(theta, item.b) });
    }
  }
  return responses;
}

function contrastOf(responses: ReturnType<typeof makeData>) {
  const result = calibrate(responses);
  return analyseDimensionality({
    responses,
    difficulties: new Map(result.items.map((i) => [i.itemId, i.difficulty])),
    abilities: new Map(result.persons.map((p) => [p.personId, p.ability])),
  });
}

test("одномерный тест не вызывает подозрений", () => {
  const r = contrastOf(makeData(101, 0));
  assert.ok(r !== null);
  assert.equal(
    r.suspect,
    false,
    `контраст ${r.firstContrast} против потолка шума ${r.noiseCeiling}`,
  );
});

test("подмешанное второе измерение видно", () => {
  const r = contrastOf(makeData(202, 0.4));
  assert.ok(r !== null);
  assert.equal(
    r.suspect,
    true,
    `контраст ${r.firstContrast} против потолка шума ${r.noiseCeiling}`,
  );
});

test("потолок шума растёт, когда заданий много, а учеников мало", () => {
  // Тот же одномерный тест, но когорта втрое меньше: случайные корреляции
  // остатков сильнее, и планка обязана подняться вслед за ними.
  const full = makeData(404, 0);
  const thin = full.filter((r) => r.personId <= 60);
  const wide = contrastOf(full);
  const narrow = contrastOf(thin);
  assert.ok(wide !== null && narrow !== null);
  assert.ok(
    narrow.noiseCeiling > wide.noiseCeiling,
    `${narrow.noiseCeiling} должен быть выше ${wide.noiseCeiling}`,
  );
  assert.equal(narrow.suspect, false);
});

test("полюса контраста разделяют задания по измерениям", () => {
  const responses = makeData(202, 0.4);
  const r = contrastOf(responses);
  assert.ok(r !== null);

  // Задания второго измерения — это id 1..12 (первые 40% из тридцати).
  const top = r.loadings.slice(0, 8).map((l) => l.itemId);
  const bottom = r.loadings.slice(-8).map((l) => l.itemId);
  const secondOnTop = top.filter((id) => id <= 12).length;
  const secondOnBottom = bottom.filter((id) => id <= 12).length;

  // Один полюс должен состоять почти целиком из заданий одного измерения.
  assert.ok(
    Math.max(secondOnTop, secondOnBottom) >= 6,
    `полюса не разделили измерения: сверху ${secondOnTop}, снизу ${secondOnBottom}`,
  );
});

test("на коротком или малолюдном тесте отказывается считать", () => {
  const responses = makeData(303, 0).filter((r) => r.personId <= 10);
  assert.equal(contrastOf(responses), null);
  const short = makeData(303, 0).filter((r) => r.itemId <= 3);
  assert.equal(contrastOf(short), null);
});
