/**
 * One template for every notification the platform sends to staff.
 *
 * Before this, each job wrote its own one-line string, so the admin chat was
 * a wall of unrelated sentences with no way to find anything later. Here a
 * notification is described as data (what happened + about whom), and this
 * module is the only place that decides how it looks.
 *
 * Three rules the template exists to enforce:
 *
 *  1. Every message has the same shape — headline, subject rows, what to do.
 *  2. Every message ends with hashtags, so the group's search box works as
 *     an index: `#trial_expired` for the kind, `#student_12` for one
 *     student's whole history, `#course_3` for one course.
 *  3. Hashtags are ASCII and language-independent on purpose. A teacher who
 *     switches the interface to Uzbek must still find messages written while
 *     it was Russian — a translated tag would silently split the archive.
 *
 * Messages are sent with parse_mode HTML (the rest of the bot is plain
 * text), so every value that came from a human — a course title, a student's
 * name, a free-text reason — goes through `escapeHtml`.
 */
import { formatDateTime, t, type Language, type StringKey } from "./i18n.js";

/** Kinds of staff notification, in the order they appear in the lifecycle. */
export type StaffAlert =
  | { kind: "application_submitted"; phone: string; parentPhone: string; parentPhoneSecondary?: string | null; aboutSelf?: string | null; inviteSent: boolean }
  | { kind: "group_invite_failed"; context: "application" | "access_granted" }
  | { kind: "trial_expired"; lessonsConsumed: number; allowance: number }
  | { kind: "access_expiring"; expiresAt: Date }
  | { kind: "access_expired"; expiresAt: Date }
  | { kind: "cert_attempt_submitted"; examTitle: string; isLate: boolean }
  | { kind: "unreviewed_homework"; count: number }
  | { kind: "blacklisted"; auto: boolean; reason?: string | null }
  | { kind: "student_removed"; actor: string; removed: boolean; failureReason?: string | null };

export type StaffAlertKind = StaffAlert["kind"];

/** Who the alert is about — resolved once, by the sender, for every kind. */
export type AlertSubject = {
  studentId?: number;
  studentLabel?: string | null;
  courseId?: number;
  courseTitle?: string | null;
};

/**
 * The `notification_type` enum value each kind is logged under. Several
 * kinds share one value where the log has always treated them as one event
 * (auto and manual blacklisting, for instance).
 */
const LOG_TYPE = {
  application_submitted: "application_submitted",
  group_invite_failed: "group_invite_failed",
  trial_expired: "trial_expired",
  access_expiring: "access_expiring_soon",
  access_expired: "access_expired",
  cert_attempt_submitted: "cert_attempt_submitted",
  unreviewed_homework: "unreviewed_homework_summary",
  blacklisted: "blacklist_event",
  student_removed: "student_removed",
} as const satisfies Record<StaffAlertKind, string>;

export type StaffNotificationType = (typeof LOG_TYPE)[StaffAlertKind];

export function logTypeFor(kind: StaffAlertKind): StaffNotificationType {
  return LOG_TYPE[kind];
}

/**
 * Leading marker per kind. Not decoration: an assistant scrolling the group
 * should be able to tell "needs a decision today" (🔴) from "for your
 * information" (🟢) without reading a word.
 */
const MARKER: Record<StaffAlertKind, string> = {
  application_submitted: "🟢",
  group_invite_failed: "🛑",
  trial_expired: "🔴",
  access_expiring: "🟡",
  access_expired: "🔴",
  cert_attempt_submitted: "🔵",
  unreviewed_homework: "🔵",
  blacklisted: "⚫️",
  student_removed: "⚪️",
};

const TITLE: Record<StaffAlertKind, StringKey> = {
  application_submitted: "alertTitleApplication",
  group_invite_failed: "alertTitleInviteFailed",
  trial_expired: "alertTitleTrialExpired",
  access_expiring: "alertTitleAccessExpiring",
  access_expired: "alertTitleAccessExpired",
  cert_attempt_submitted: "alertTitleCertAttempt",
  unreviewed_homework: "alertTitleUnreviewed",
  blacklisted: "alertTitleBlacklisted",
  student_removed: "alertTitleRemoved",
};

const RULE = "━━━━━━━━━━━━━━━";

/** Umbrella tag on every message — one search shows the whole admin feed. */
export const UMBRELLA_TAG = "#biolog_admin";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Row = { icon: string; labelKey: StringKey; value: string };

/**
 * The kind-specific half: which rows to show and what to advise. Everything
 * common — headline, subject, hashtags — is added by `renderStaffAlert`.
 */
function detailRows(lang: Language, alert: StaffAlert): { rows: Row[]; actionKey: StringKey | null } {
  switch (alert.kind) {
    case "application_submitted":
      return {
        rows: [
          { icon: "📱", labelKey: "alertRowPhone", value: alert.phone },
          {
            icon: "👪",
            labelKey: "alertRowParentPhone",
            value: alert.parentPhoneSecondary
              ? `${alert.parentPhone}, ${alert.parentPhoneSecondary}`
              : alert.parentPhone,
          },
          ...(alert.aboutSelf
            ? [{ icon: "📝", labelKey: "alertRowAbout" as StringKey, value: trim(alert.aboutSelf, 300) }]
            : []),
          {
            icon: alert.inviteSent ? "✅" : "⚠️",
            labelKey: "alertRowInvite",
            value: t(lang, alert.inviteSent ? "alertInviteSent" : "alertInviteNotSent"),
          },
        ],
        actionKey: alert.inviteSent ? "alertActionApplication" : "alertActionInviteFailed",
      };

    case "group_invite_failed":
      return {
        rows: [
          {
            icon: "🧩",
            labelKey: "alertRowContext",
            value: t(lang, alert.context === "application" ? "alertContextApplication" : "alertContextAccessGranted"),
          },
        ],
        actionKey: "alertActionInviteFailed",
      };

    case "trial_expired":
      return {
        rows: [
          {
            icon: "📊",
            labelKey: "alertRowLessons",
            value: t(lang, "alertLessonsOfFree", { used: alert.lessonsConsumed, free: alert.allowance }),
          },
          { icon: "🧊", labelKey: "alertRowState", value: t(lang, "alertStateFrozen") },
        ],
        actionKey: "alertActionTrialExpired",
      };

    case "access_expiring":
      return {
        rows: [{ icon: "⏳", labelKey: "alertRowExpiresAt", value: formatDateTime(lang, alert.expiresAt) }],
        actionKey: "alertActionAccessExpiring",
      };

    case "access_expired":
      return {
        rows: [{ icon: "⌛️", labelKey: "alertRowExpiredAt", value: formatDateTime(lang, alert.expiresAt) }],
        actionKey: "alertActionAccessExpired",
      };

    case "cert_attempt_submitted":
      return {
        rows: [
          { icon: "🎓", labelKey: "alertRowExam", value: alert.examTitle },
          ...(alert.isLate
            ? [{ icon: "⏰", labelKey: "alertRowStatus" as StringKey, value: t(lang, "alertLate") }]
            : []),
        ],
        actionKey: "alertActionCertAttempt",
      };

    case "unreviewed_homework":
      return {
        rows: [{ icon: "📋", labelKey: "alertRowPending", value: String(alert.count) }],
        actionKey: "alertActionUnreviewed",
      };

    case "blacklisted":
      return {
        rows: [
          {
            icon: "⚙️",
            labelKey: "alertRowSource",
            value: t(lang, alert.auto ? "alertSourceAuto" : "alertSourceManual"),
          },
          ...(alert.reason
            ? [{ icon: "💬", labelKey: "alertRowReason" as StringKey, value: trim(alert.reason, 300) }]
            : []),
        ],
        actionKey: "alertActionBlacklisted",
      };

    case "student_removed":
      return {
        rows: [
          { icon: "🙋", labelKey: "alertRowActor", value: alert.actor },
          {
            icon: alert.removed ? "✅" : "⚠️",
            labelKey: "alertRowResult",
            value: alert.removed
              ? t(lang, "alertRemovedOk")
              : t(lang, "alertRemovedFailed", { reason: alert.failureReason ?? "—" }),
          },
        ],
        actionKey: alert.removed ? null : "alertActionRemoveFailed",
      };
  }
}

/** Keeps a free-text field from turning one notification into a wall of text. */
function trim(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function hashtags(alert: StaffAlert, subject: AlertSubject): string {
  const tags = [`#${alert.kind}`];
  if (subject.studentId !== undefined) tags.push(`#student_${subject.studentId}`);
  if (subject.courseId !== undefined) tags.push(`#course_${subject.courseId}`);
  tags.push(UMBRELLA_TAG);
  return tags.join(" ");
}

/** Builds the HTML message body. Pure — no DB, no Telegram, fully testable. */
export function renderStaffAlert(lang: Language, alert: StaffAlert, subject: AlertSubject = {}): string {
  const { rows, actionKey } = detailRows(lang, alert);
  const lines: string[] = [`${MARKER[alert.kind]} <b>${escapeHtml(t(lang, TITLE[alert.kind]))}</b>`, RULE];

  if (subject.studentId !== undefined) {
    const name = subject.studentLabel ? `${escapeHtml(subject.studentLabel)} · ` : "";
    lines.push(`👤 <b>${escapeHtml(t(lang, "alertRowStudent"))}:</b> ${name}#${subject.studentId}`);
  }
  if (subject.courseTitle || subject.courseId !== undefined) {
    const title = subject.courseTitle ? escapeHtml(subject.courseTitle) : `#${subject.courseId}`;
    lines.push(`📚 <b>${escapeHtml(t(lang, "alertRowCourse"))}:</b> ${title}`);
  }
  for (const row of rows) {
    lines.push(`${row.icon} <b>${escapeHtml(t(lang, row.labelKey))}:</b> ${escapeHtml(row.value)}`);
  }
  if (actionKey) lines.push("", `➡️ ${escapeHtml(t(lang, actionKey))}`);
  lines.push("", hashtags(alert, subject));

  return lines.join("\n");
}
