import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidTaskNumber,
  taskKind,
  optionsFor,
  isClosedTask,
  maxPointsFor,
  topicFor,
  taskTypeFor,
  discriminationBand,
  itemCode,
  ALL_TASK_NUMBERS,
  KEY_TASK_NUMBERS,
  PHOTO_TASK_NUMBERS,
  TOTAL_MAX_POINTS,
  AUTO_MAX_POINTS,
  CERT_TASK_MAX,
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
