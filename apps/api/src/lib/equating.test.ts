import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  equateScore,
  expectedCorrect,
  measureForScore,
  scoreTable,
  standardError,
} from "./equating.js";

/** Сорок заданий, трудность от −2 до +2 — форма настоящего варианта. */
const variant = Array.from({ length: 40 }, (_, i) => -2 + (4 * i) / 39);

test("уровень возвращает ровно ту сумму, из которой посчитан", () => {
  for (const raw of [1, 10, 20, 30, 39]) {
    const measure = measureForScore(raw, variant);
    assert.ok(measure !== null);
    assert.ok(Math.abs(expectedCorrect(measure, variant) - raw) < 0.001);
  }
});

test("больше верных — выше уровень", () => {
  let previous = -Infinity;
  for (let raw = 1; raw < variant.length; raw += 1) {
    const measure = measureForScore(raw, variant);
    assert.ok(measure !== null);
    assert.ok(measure > previous, `сумма ${raw} не подняла уровень`);
    previous = measure;
  }
});

test("ноль верных и все верные не имеют конечного уровня", () => {
  assert.equal(measureForScore(0, variant), null);
  assert.equal(measureForScore(40, variant), null);
  assert.equal(measureForScore(5, []), null);
});

test("тест меряет точнее всего тех, кому он впору", () => {
  const middle = standardError(0, variant);
  const edge = standardError(4, variant);
  assert.ok(middle < edge, "у края ошибка должна быть больше");
  assert.ok(middle > 0 && Number.isFinite(middle));
});

test("эталон, равный самому себе, не меняет результата", () => {
  const r = equateScore({
    correct: 25,
    variantDifficulties: variant,
    referenceDifficulties: variant,
    linked: true,
  });
  assert.equal(r.status, "ok");
  assert.ok(Math.abs((r.equated_correct as number) - 25) < 0.1);
});

test("на трудном варианте та же сумма стоит дороже", () => {
  // Тот же набор, но каждое задание на полулогита труднее.
  const harder = variant.map((b) => b + 0.5);
  const r = equateScore({
    correct: 25,
    variantDifficulties: harder,
    referenceDifficulties: variant,
    linked: true,
  });
  assert.equal(r.status, "ok");
  assert.ok(
    (r.equated_correct as number) > 25,
    `эквивалент ${r.equated_correct} должен быть выше сырых 25`,
  );
  // Полулогита разницы на середине шкалы — это около двух заданий из сорока.
  assert.ok((r.equated_correct as number) < 29);
});

test("на лёгком варианте та же сумма стоит дешевле", () => {
  const easier = variant.map((b) => b - 0.5);
  const r = equateScore({
    correct: 25,
    variantDifficulties: easier,
    referenceDifficulties: variant,
    linked: true,
  });
  assert.ok((r.equated_correct as number) < 25);
});

test("несвязанный вариант переводить не во что", () => {
  const r = equateScore({
    correct: 25,
    variantDifficulties: variant,
    referenceDifficulties: variant,
    linked: false,
  });
  assert.equal(r.status, "not_linked");
  assert.equal(r.equated_correct, null);
});

test("без калибровки поправки нет", () => {
  const r = equateScore({
    correct: 25,
    variantDifficulties: [],
    referenceDifficulties: variant,
    linked: true,
  });
  assert.equal(r.status, "not_calibrated");
});

test("крайние суммы названы, а не выдуманы", () => {
  const low = equateScore({
    correct: 0,
    variantDifficulties: variant,
    referenceDifficulties: variant,
    linked: true,
  });
  const high = equateScore({
    correct: 40,
    variantDifficulties: variant,
    referenceDifficulties: variant,
    linked: true,
  });
  assert.equal(low.status, "below_range");
  assert.equal(high.status, "above_range");
});

test("таблица перевода покрывает все промежуточные суммы", () => {
  const rows = scoreTable(variant);
  assert.equal(rows.length, 39);
  assert.equal(rows[0].raw, 1);
  assert.equal(rows[38].raw, 39);
});
