import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_TASK_NUMBERS,
  AUTO_MAX_POINTS,
  CERT_TASK_MAX,
  KEY_TASK_NUMBERS,
  PHOTO_TASK_NUMBERS,
  TOTAL_MAX_POINTS,
  certGrade,
  discriminationBand,
  estimateCertScore,
  gradeTypedAnswer,
  isClosedTask,
  isValidTaskNumber,
  itemCode,
  matchesAnswerKey,
  maxPartsFor,
  maxPointsFor,
  normalizeAnswer,
  optionsFor,
  splitPoints,
  taskKind,
  taskTypeFor,
  topicFor,
} from "./certExam.js";

// Pure structure/scoring/statistics helpers — the one place with real
// arithmetic and hard specification boundaries, and where regressions are
// silent (a wrong topic tag or a shifted band threshold still "runs").
// Run: npm run test:unit --workspace=apps/api

test("isValidTaskNumber accepts 1..43 and rejects everything else", () => {
  assert.equal(isValidTaskNumber(1), true);
  assert.equal(isValidTaskNumber(43), true);
  assert.equal(isValidTaskNumber(0), false);
  assert.equal(isValidTaskNumber(44), false);
  assert.equal(isValidTaskNumber(2.5), false);
  assert.equal(isValidTaskNumber(-1), false);
});

test("taskKind boundaries match the spec (32/35/40)", () => {
  assert.equal(taskKind(1), "closed_ad");
  assert.equal(taskKind(32), "closed_ad");
  assert.equal(taskKind(33), "closed_af"); // first shared-stem A–F task
  assert.equal(taskKind(35), "closed_af");
  assert.equal(taskKind(36), "open_short"); // first photo task
  assert.equal(taskKind(40), "open_short");
  assert.equal(taskKind(41), "open_extended");
  assert.equal(taskKind(43), "open_extended");
});

test("optionsFor gives 4 for A–D, 6 for A–F, none for open tasks", () => {
  assert.deepEqual(optionsFor(1), ["A", "B", "C", "D"]);
  assert.deepEqual(optionsFor(33), ["A", "B", "C", "D", "E", "F"]);
  assert.deepEqual(optionsFor(36), []);
  assert.deepEqual(optionsFor(43), []);
});

test("isClosedTask splits at 35 (key vs photo)", () => {
  assert.equal(isClosedTask(35), true);
  assert.equal(isClosedTask(36), false);
});

test("maxPointsFor: 1 for closed/short, spec weights for extended", () => {
  assert.equal(maxPointsFor(1), 1);
  assert.equal(maxPointsFor(35), 1);
  assert.equal(maxPointsFor(40), 1);
  assert.equal(maxPointsFor(41), 30);
  assert.equal(maxPointsFor(42), 35);
  assert.equal(maxPointsFor(43), 10);
});

test("aggregate totals: 43 tasks, 35 key, 8 photo, 115 / 35 points", () => {
  assert.equal(ALL_TASK_NUMBERS.length, CERT_TASK_MAX);
  assert.equal(KEY_TASK_NUMBERS.length, 35);
  assert.equal(PHOTO_TASK_NUMBERS.length, 8);
  assert.equal(TOTAL_MAX_POINTS, 115); // 35 closed + 5 short + (30+35+10)
  assert.equal(AUTO_MAX_POINTS, 35); // reachable without manual review
});

test("topicFor follows the §IV section table at every boundary", () => {
  assert.equal(topicFor(1), "life_science");
  assert.equal(topicFor(2), "cell");
  assert.equal(topicFor(11), "cell");
  assert.equal(topicFor(12), "systematics");
  assert.equal(topicFor(13), "plants_animals");
  assert.equal(topicFor(19), "plants_animals");
  assert.equal(topicFor(20), "human");
  assert.equal(topicFor(23), "human");
  assert.equal(topicFor(24), "species_population");
  assert.equal(topicFor(28), "species_population");
  assert.equal(topicFor(29), "ecosystem");
  assert.equal(topicFor(32), "ecosystem");
  assert.equal(topicFor(33), "logic");
  assert.equal(topicFor(35), "logic");
  assert.equal(topicFor(36), "general_bio");
  assert.equal(topicFor(43), "general_bio");
});

test("taskTypeFor maps position to spec §III code", () => {
  assert.equal(taskTypeFor(32), "Y1");
  assert.equal(taskTypeFor(33), "Y2");
  assert.equal(taskTypeFor(40), "O1");
  assert.equal(taskTypeFor(41), "O2");
});

test("discriminationBand thresholds: broken/-0.15, weak/0.2, ok/0.35", () => {
  // The exact boundaries that caused the false "broken key" accusation bug.
  assert.equal(discriminationBand(-1), "broken");
  assert.equal(discriminationBand(-0.16), "broken");
  assert.equal(discriminationBand(-0.15), "weak"); // boundary is inclusive-up
  assert.equal(discriminationBand(-0.09), "weak"); // the real lottery-item case
  assert.equal(discriminationBand(0.19), "weak");
  assert.equal(discriminationBand(0.2), "ok");
  assert.equal(discriminationBand(0.34), "ok");
  assert.equal(discriminationBand(0.35), "good");
  assert.equal(discriminationBand(1), "good");
});

test("itemCode is <task>-<zero-padded id>", () => {
  assert.equal(itemCode(7, 12), "12-0007");
  assert.equal(itemCode(1234, 5), "5-1234");
  assert.equal(itemCode(1, 43), "43-0001");
});

// --- final score on the certificate scale ---

test("total is the plain mean of the two halves", () => {
  // A real issued certificate reports test 46.71, written 48.62, total 47.67 —
  // the mean, not a weighted sum. This is the property that must hold.
  const half = estimateCertScore({ testCorrect: 40, writtenPoints: 0 });
  assert.equal(half.test, 65);
  assert.equal(half.written, 0);
  assert.equal(half.total, 32.5);

  const other = estimateCertScore({ testCorrect: 0, writtenPoints: 75 });
  assert.equal(other.total, 32.5, "the written half weighs exactly as much as the test half");
});

test("three written tasks carry the same weight as forty test tasks", () => {
  // The whole reason for this scale: under the old flat 115-point total the
  // written part was 65% of the score. Here the two halves must be equal.
  const allTest = estimateCertScore({ testCorrect: 40, writtenPoints: 0 });
  const allWritten = estimateCertScore({ testCorrect: 0, writtenPoints: 75 });
  assert.equal(allTest.total, allWritten.total);
});

test("a perfect attempt reaches the reference score and 100%", () => {
  const perfect = estimateCertScore({ testCorrect: 40, writtenPoints: 75 });
  assert.equal(perfect.total, 65);
  assert.equal(perfect.percent, 100);
  assert.equal(perfect.grade, "A", "A+ is unreachable without a Rasch estimate above the reference");
});

test("an empty attempt earns no certificate at all", () => {
  const none = estimateCertScore({ testCorrect: 0, writtenPoints: 0 });
  assert.equal(none.total, 0);
  assert.equal(none.percent, 0);
  assert.equal(none.grade, null, "below 46 there is no certificate, not a low grade");
});

test("grade bands match the agency's published table", () => {
  assert.equal(certGrade(70.1), "A+");
  assert.equal(certGrade(69.9), "A");
  assert.equal(certGrade(65), "A");
  assert.equal(certGrade(64.9), "B+");
  assert.equal(certGrade(60), "B+");
  assert.equal(certGrade(59.9), "B");
  assert.equal(certGrade(55), "B");
  assert.equal(certGrade(54.9), "C+");
  assert.equal(certGrade(50), "C+");
  assert.equal(certGrade(49.9), "C");
  assert.equal(certGrade(46), "C", "46 is the exact floor for a certificate");
  assert.equal(certGrade(45.99), null);
});

test("exactly 70 falls on the conservative side of the published gap", () => {
  // The table lists A as 65–69.9 and A+ as "above 70", leaving 70.0 unnamed.
  assert.equal(certGrade(70), "A");
});

test("percentage caps at 100 while the grade keeps climbing", () => {
  // Mirrors the real certificate: past the reference the percentage stops
  // moving but the band still rises.
  assert.equal(certGrade(72), "A+");
  const capped = estimateCertScore({ testCorrect: 999, writtenPoints: 999 });
  assert.equal(capped.percent, 100);
  assert.equal(capped.total, 65, "impossible inputs are clamped, never extrapolated");
});

test("a middling attempt lands where the bands say it should", () => {
  // 30/40 and 50/75 → both halves two thirds-ish, total just under C.
  const e = estimateCertScore({ testCorrect: 30, writtenPoints: 50 });
  assert.equal(e.test, 48.75);
  assert.equal(e.written, 43.33);
  assert.equal(e.total, 46.04);
  assert.equal(e.grade, "C");
});

// ---------------------------------------------------------------------
// Открытые задания с вводом ответа
// ---------------------------------------------------------------------

test("частей: у краткого ответа одна, у развёрнутого до шести", () => {
  assert.equal(maxPartsFor(36), 1);
  assert.equal(maxPartsFor(40), 1);
  assert.equal(maxPartsFor(41), 6);
  assert.equal(maxPartsFor(43), 6);
  // Закрытые задания сюда не относятся вовсе.
  assert.equal(maxPartsFor(1), 0);
  assert.equal(maxPartsFor(35), 0);
});

test("баллы делятся поровну, остаток уходит первым частям", () => {
  assert.deepEqual(splitPoints(30, 3), [10, 10, 10]);
  assert.deepEqual(splitPoints(35, 3), [12, 12, 11]);
  assert.deepEqual(splitPoints(10, 4), [3, 3, 2, 2]);
  assert.deepEqual(splitPoints(30, 1), [30]);
  assert.equal(splitPoints(35, 6).reduce((a, b) => a + b, 0), 35);
});

test("сумма баллов по частям равна максимуму задания при любом делении", () => {
  for (const task of [41, 42, 43]) {
    for (let parts = 1; parts <= 6; parts++) {
      const sum = splitPoints(maxPointsFor(task), parts).reduce((a, b) => a + b, 0);
      assert.equal(sum, maxPointsFor(task), `задание ${task}, частей ${parts}`);
    }
  }
});

test("нормализация не считает разницей то, что разницей не является", () => {
  const same = (a: string, b: string) => assert.equal(normalizeAnswer(a), normalizeAnswer(b), `${a} ≠ ${b}`);
  same("Митохондрия", "митохондрия");
  same("  митохондрия  ", "митохондрия");
  same("зелёный", "зеленый");
  same("0,5", "0.5");
  same("митохондрия.", "митохондрия");
  same("клеточный   центр", "клеточный центр");
  // Узбекская латиница: апостроф набирают пятью разными знаками.
  same("o‘simlik", "o'simlik");
  same("gʻisht", "g'isht");
});

test("нормализация оставляет разницей то, что ею является", () => {
  assert.notEqual(normalizeAnswer("митохондрия"), normalizeAnswer("митохондрии"));
  assert.notEqual(normalizeAnswer("0.5"), normalizeAnswer("0.55"));
  assert.notEqual(normalizeAnswer("ядро"), normalizeAnswer("ядрышко"));
});

test("синонимы задаёт преподаватель, а не догадка", () => {
  const key = ["митохондрия", "митохондрии", "mitoxondriya"];
  assert.ok(matchesAnswerKey("Митохондрия", key));
  assert.ok(matchesAnswerKey("митохондрии", key));
  assert.ok(matchesAnswerKey(" MITOXONDRIYA ", key));
  // Формы, которых нет в списке, не засчитываются: платформа не должна
  // сама решать, что «митохондриями» — тоже верно.
  assert.equal(matchesAnswerKey("митохондриями", key), false);
  assert.equal(matchesAnswerKey("", key), false);
  assert.equal(matchesAnswerKey("   ", key), false);
});

test("оценка развёрнутого задания складывается из угаданных частей", () => {
  const key = [["хлоропласт"], ["митохондрия"], ["ядро"]];
  assert.deepEqual(
    gradeTypedAnswer({ taskNumber: 41, given: ["хлоропласт", "митохондрия", "ядро"], key }),
    { partCorrect: [true, true, true], awardedPoints: 30 },
  );
  assert.deepEqual(
    gradeTypedAnswer({ taskNumber: 41, given: ["хлоропласт", "ошибка", "ядро"], key }),
    { partCorrect: [true, false, true], awardedPoints: 20 },
  );
  assert.deepEqual(
    gradeTypedAnswer({ taskNumber: 41, given: [null, null, null], key }),
    { partCorrect: [false, false, false], awardedPoints: 0 },
  );
});

test("непройденная часть не роняет расчёт: пропущенных ответов может не быть вовсе", () => {
  const key = [["а"], ["б"]];
  const graded = gradeTypedAnswer({ taskNumber: 42, given: ["а"], key });
  assert.deepEqual(graded.partCorrect, [true, false]);
  assert.equal(graded.awardedPoints, 18); // 35 на две части: 18 и 17
});

test("краткий ответ 36–40 стоит один балл целиком", () => {
  const graded = gradeTypedAnswer({ taskNumber: 37, given: ["ядро"], key: [["ядро"]] });
  assert.deepEqual(graded, { partCorrect: [true], awardedPoints: 1 });
});
