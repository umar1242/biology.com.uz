import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrialExhausted, lessonsConsumedSince } from "./trial.js";

const start = new Date("2026-03-01T00:00:00Z");
const before = new Date("2026-02-01T00:00:00Z");
const after1 = new Date("2026-03-05T00:00:00Z");
const after2 = new Date("2026-03-12T00:00:00Z");
const after3 = new Date("2026-03-19T00:00:00Z");

test("lessons published before the student joined do not count", () => {
  assert.equal(lessonsConsumedSince([before, before], start), 0);
  assert.equal(lessonsConsumedSince([before, after1], start), 1);
});

test("unpublished lessons (null) do not count", () => {
  assert.equal(lessonsConsumedSince([null, null, after1], start), 1);
});

test("a lesson published exactly at the join moment does not count", () => {
  // Strictly-after: a lesson that went out in the same instant the student
  // applied was not published "during" their trial.
  assert.equal(lessonsConsumedSince([new Date(start)], start), 0);
});

test("default allowance of 2 gives exactly two free lessons", () => {
  assert.equal(isTrialExhausted(lessonsConsumedSince([after1], start), 2), false);
  assert.equal(isTrialExhausted(lessonsConsumedSince([after1, after2], start), 2), false);
  assert.equal(isTrialExhausted(lessonsConsumedSince([after1, after2, after3], start), 2), true);
});

test("allowance of 0 means the first published lesson freezes them", () => {
  assert.equal(isTrialExhausted(0, 0), false);
  assert.equal(isTrialExhausted(1, 0), true);
});

test("allowance of 1 frees exactly one lesson", () => {
  assert.equal(isTrialExhausted(1, 1), false);
  assert.equal(isTrialExhausted(2, 1), true);
});
