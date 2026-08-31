import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fitVerdict, simulateFitEnvelopes } from "./fitEnvelope.js";
import { calibrate, type RaschResponse } from "./rasch.js";

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
 * Тест из L заданий и N учеников. `defect` портит задание с номером 1:
 * "reversed" — в ключе не та буква (подготовленные проваливают),
 * "random" — ответ не зависит от подготовки.
 */
function makeTest(
  seed: number,
  persons: number,
  items: number,
  defect: "none" | "reversed" | "random" = "none",
) {
  const rand = mulberry32(seed);
  const difficulty = new Map<number, number>();
  for (let i = 1; i <= items; i += 1) {
    difficulty.set(i, -2 + (4 * (i - 1)) / (items - 1));
  }

  const responses: RaschResponse[] = [];
  for (let p = 1; p <= persons; p += 1) {
    const u = Math.max(rand(), 1e-9);
    const theta = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    for (let i = 1; i <= items; i += 1) {
      const clean = rand() < P(theta, difficulty.get(i) as number);
      const correct =
        i === 1 && defect === "reversed"
          ? !clean
          : i === 1 && defect === "random"
            ? rand() < 0.5
            : clean;
      responses.push({ personId: p, itemId: i, correct });
    }
  }
  return responses;
}

function analyse(responses: RaschResponse[], simulations = 60) {
  const result = calibrate(responses);
  const difficulties = new Map(result.items.map((i) => [i.itemId, i.difficulty]));
  const abilities = new Map(result.persons.map((p) => [p.personId, p.ability]));
  const envelopes = simulateFitEnvelopes({
    responses,
    difficulties,
    abilities,
    simulations,
    seed: 4242,
  });
  return { result, envelopes };
}

test("полоса шире на малой выборке и уже на большой", () => {
  const small = analyse(makeTest(1, 30, 20));
  const large = analyse(makeTest(2, 400, 20));

  const width = (a: ReturnType<typeof analyse>) => {
    const values = [...a.envelopes.values()].map((e) => e.outfitHigh - e.outfitLow);
    return values.reduce((s, v) => s + v, 0) / values.length;
  };

  const narrow = width(large);
  const wide = width(small);
  assert.ok(wide > narrow * 1.8, `на 30 учениках полоса ${wide}, на 400 — ${narrow}`);
  // И это ровно то, из-за чего постоянный порог не работает: на тридцати
  // учениках книжные 0.7–1.3 лежат внутри разброса исправных заданий.
  assert.ok(wide > 0.6, `полоса на 30 учениках всего ${wide}`);
});

test("на исправных данных ложных обвинений почти нет", () => {
  const { result, envelopes } = analyse(makeTest(7, 200, 25));
  const flagged = result.items.filter(
    (i) => fitVerdict(i.outfit, envelopes.get(i.itemId) ?? null) !== "productive",
  );
  // Полоса двусторонняя на 95%, значит около 5% ложных ожидаемо.
  assert.ok(
    flagged.length <= Math.ceil(result.items.length * 0.2),
    `обвинено ${flagged.length} исправных заданий из ${result.items.length}`,
  );
});

test("перевёрнутый ключ ловится на потоке в 200 человек", () => {
  const { result, envelopes } = analyse(makeTest(11, 200, 25, "reversed"));
  const broken = result.items.find((i) => i.itemId === 1);
  assert.ok(broken);
  assert.equal(fitVerdict(broken.outfit, envelopes.get(1) ?? null), "underfit");
});

test("книжный порог 1.5 пропускает то, что полоса ловит", () => {
  // Задание отвечает случайно: дефект настоящий, но мягкий.
  const { result, envelopes } = analyse(makeTest(13, 200, 25, "random"));
  const broken = result.items.find((i) => i.itemId === 1);
  assert.ok(broken);
  const byEnvelope = fitVerdict(broken.outfit, envelopes.get(1) ?? null);
  const byBook = broken.outfit > 1.5 ? "underfit" : "productive";
  assert.equal(byEnvelope, "underfit");
  assert.equal(byBook, "productive", `outfit ${broken.outfit} — книжный порог тут не сработал бы`);
});

test("мощность обнаружения растёт с потоком", () => {
  // Кривая мощности: доля пойманных перевёрнутых ключей при разных размерах.
  const power = (persons: number, runs = 12) => {
    let caught = 0;
    for (let r = 0; r < runs; r += 1) {
      const { result, envelopes } = analyse(makeTest(100 + r, persons, 20, "reversed"), 40);
      const broken = result.items.find((i) => i.itemId === 1);
      if (broken && fitVerdict(broken.outfit, envelopes.get(1) ?? null) === "underfit") caught += 1;
    }
    return caught / runs;
  };

  const small = power(30);
  const large = power(150);
  console.log(`    мощность: 30 учеников — ${(small * 100).toFixed(0)}%, 150 — ${(large * 100).toFixed(0)}%`);
  assert.ok(large >= small, `мощность упала: ${small} → ${large}`);
  assert.ok(large >= 0.8, `на 150 учениках ловится только ${(large * 100).toFixed(0)}%`);
});

test("без полосы вердикт падает на книжные границы", () => {
  assert.equal(fitVerdict(1.7, null), "underfit");
  assert.equal(fitVerdict(0.4, null), "overfit");
  assert.equal(fitVerdict(1.0, null), "productive");
});
