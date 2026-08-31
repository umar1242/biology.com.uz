import { strict as assert } from "node:assert";
import { test } from "node:test";
import { compareAnchors, DRIFT_MIN_LOGITS, MIN_STABLE_ANCHORS } from "./anchorDrift.js";

const measure = (itemId: number, difficulty: number, standardError = 0.2) => ({
  itemId,
  difficulty,
  standardError,
});

test("общий сдвиг шкалы не считается дрейфом", () => {
  // Второй вариант целиком смещён на +0.8 — это разное начало отсчёта,
  // а не изменившиеся задания.
  const first = [measure(1, -1), measure(2, 0), measure(3, 1)];
  const second = first.map((m) => measure(m.itemId, m.difficulty - 0.8));
  const { shift, drifts } = compareAnchors(first, second);
  assert.ok(Math.abs(shift - 0.8) < 1e-9);
  assert.ok(drifts.every((d) => Math.abs(d.drift) < 1e-9));
  assert.ok(drifts.every((d) => !d.drifted));
});

test("одно уехавшее задание находится, остальные остаются чистыми", () => {
  const first = [measure(1, -1), measure(2, 0), measure(3, 1), measure(4, 2)];
  const second = [measure(1, -1), measure(2, 0), measure(3, 1), measure(4, 0.5)];
  const { drifts } = compareAnchors(first, second);
  const bad = drifts.filter((d) => d.drifted);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].itemId, 4);
  assert.ok(bad[0].drift > DRIFT_MIN_LOGITS);
});

test("большое расхождение при большой ошибке флага не даёт", () => {
  // Полтора логита разницы, но SE у обеих оценок по логиту: это шум.
  const first = [measure(1, 0, 1), measure(2, 0, 1), measure(3, 1.5, 1)];
  const second = [measure(1, 0, 1), measure(2, 0, 1), measure(3, 0, 1)];
  const { drifts } = compareAnchors(first, second);
  const bad = drifts.filter((d) => d.drifted);
  assert.equal(bad.length, 0, "шум не должен объявляться дрейфом");
});

test("маленькое, но точно измеренное расхождение тоже не флаг", () => {
  // Значимо (z велико), но содержательно ничтожно — треть десятой логита.
  const first = [measure(1, 0, 0.01), measure(2, 0, 0.01), measure(3, 0.03, 0.01)];
  const second = [measure(1, 0, 0.01), measure(2, 0, 0.01), measure(3, 0, 0.01)];
  const { drifts } = compareAnchors(first, second);
  assert.ok(drifts.every((d) => !d.drifted));
});

test("без общих заданий сравнивать нечего", () => {
  const { shift, drifts } = compareAnchors([measure(1, 0)], [measure(9, 0)]);
  assert.equal(shift, 0);
  assert.equal(drifts.length, 0);
});

test("порог устойчивых якорей объявлен и не единица", () => {
  assert.ok(MIN_STABLE_ANCHORS >= 3);
});
