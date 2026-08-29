import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UMBRELLA_TAG,
  escapeHtml,
  logTypeFor,
  renderStaffAlert,
  type StaffAlert,
} from "./staffAlerts.js";

const subject = { studentId: 12, studentLabel: "Иван Петров", courseId: 3, courseTitle: "Биология 11" };

/** One of every kind — the table the shape tests below iterate over. */
const EVERY_KIND: StaffAlert[] = [
  {
    kind: "application_submitted",
    phone: "+998901234567",
    parentPhone: "+998901112233",
    parentPhoneSecondary: null,
    aboutSelf: "Учусь в 11 классе",
    inviteSent: true,
  },
  { kind: "group_invite_failed", context: "application" },
  { kind: "trial_expired", lessonsConsumed: 3, allowance: 2 },
  { kind: "access_expiring", expiresAt: new Date("2026-09-01T10:00:00Z") },
  { kind: "access_expired", expiresAt: new Date("2026-08-01T10:00:00Z") },
  { kind: "cert_attempt_submitted", examTitle: "Вариант 4", isLate: true },
  { kind: "unreviewed_homework", count: 7 },
  { kind: "blacklisted", auto: true },
  { kind: "student_removed", actor: "Умархан", removed: true },
];

test("every kind renders in both languages with a headline and hashtags", () => {
  for (const lang of ["ru", "uz"] as const) {
    for (const alert of EVERY_KIND) {
      const text = renderStaffAlert(lang, alert, subject);
      const lines = text.split("\n");
      assert.ok(lines[0].includes("<b>"), `${alert.kind}/${lang}: no headline`);
      assert.ok(lines.at(-1)?.startsWith("#"), `${alert.kind}/${lang}: no hashtag line`);
      // A missing i18n substitution would ship a literal "{used}" to the
      // admin group — cheap to catch here, embarrassing to catch there.
      assert.ok(!/\{[a-z_]+\}/.test(text), `${alert.kind}/${lang}: unsubstituted placeholder`);
    }
  }
});

test("hashtags carry the kind and both entity ids", () => {
  const text = renderStaffAlert("ru", { kind: "trial_expired", lessonsConsumed: 3, allowance: 2 }, subject);
  const tags = text.split("\n").at(-1)!.split(" ");
  assert.deepEqual(tags, ["#trial_expired", "#student_12", "#course_3", UMBRELLA_TAG]);
});

test("hashtags are identical across languages — search must not depend on the UI language", () => {
  for (const alert of EVERY_KIND) {
    const ru = renderStaffAlert("ru", alert, subject).split("\n").at(-1);
    const uz = renderStaffAlert("uz", alert, subject).split("\n").at(-1);
    assert.equal(ru, uz, alert.kind);
  }
});

test("a subject without a student or course produces no empty rows and no dangling tags", () => {
  const text = renderStaffAlert("ru", { kind: "unreviewed_homework", count: 7 });
  assert.ok(!text.includes("#student_"));
  assert.ok(!text.includes("#course_"));
  assert.ok(!text.includes("undefined"));
  assert.ok(!text.includes("null"));
  assert.equal(text.split("\n").at(-1), `#unreviewed_homework ${UMBRELLA_TAG}`);
});

test("human-typed values are escaped — a course title with markup cannot break the message", () => {
  const text = renderStaffAlert(
    "ru",
    { kind: "blacklisted", auto: false, reason: "прогулял <b>всё</b> & исчез" },
    { ...subject, courseTitle: "Химия <8>" },
  );
  assert.ok(text.includes("Химия &lt;8&gt;"));
  assert.ok(text.includes("прогулял &lt;b&gt;всё&lt;/b&gt; &amp; исчез"));
  // Only the template's own tags may remain as real markup.
  assert.equal(text.match(/<b>/g)?.length, text.match(/<\/b>/g)?.length);
});

test("escapeHtml leaves ordinary text alone", () => {
  assert.equal(escapeHtml("Биология 11 «А»"), "Биология 11 «А»");
});

test("a long free-text field is trimmed instead of flooding the group", () => {
  const text = renderStaffAlert(
    "ru",
    {
      kind: "application_submitted",
      phone: "+998901234567",
      parentPhone: "+998901112233",
      aboutSelf: "я ".repeat(500),
      inviteSent: true,
    },
    subject,
  );
  const aboutLine = text.split("\n").find((l) => l.startsWith("📝"))!;
  assert.ok(aboutLine.length < 340, `about line is ${aboutLine.length} chars`);
  assert.ok(aboutLine.endsWith("…"));
});

test("a failed invite changes the advice, not just the row", () => {
  const base = {
    kind: "application_submitted" as const,
    phone: "+998901234567",
    parentPhone: "+998901112233",
  };
  const ok = renderStaffAlert("ru", { ...base, inviteSent: true }, subject);
  const failed = renderStaffAlert("ru", { ...base, inviteSent: false }, subject);
  assert.notEqual(
    ok.split("\n").find((l) => l.startsWith("➡️")),
    failed.split("\n").find((l) => l.startsWith("➡️")),
  );
});

test("a successful removal gives no advice; a failed one tells the admin to do it by hand", () => {
  const ok = renderStaffAlert("ru", { kind: "student_removed", actor: "Умархан", removed: true }, subject);
  const failed = renderStaffAlert(
    "ru",
    { kind: "student_removed", actor: "Умархан", removed: false, failureReason: "telegram_error" },
    subject,
  );
  assert.ok(!ok.includes("➡️"));
  assert.ok(failed.includes("➡️"));
  assert.ok(failed.includes("telegram_error"));
});

test("each kind maps to a notification_type the log's enum knows", () => {
  const allowed = new Set([
    "access_expiring_soon",
    "access_expired",
    "blacklist_event",
    "unreviewed_homework_summary",
    "trial_expired",
    "application_submitted",
    "cert_attempt_submitted",
    "student_removed",
    "group_invite_failed",
  ]);
  for (const alert of EVERY_KIND) assert.ok(allowed.has(logTypeFor(alert.kind)), alert.kind);
});
