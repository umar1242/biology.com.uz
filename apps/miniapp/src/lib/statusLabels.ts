import type { StringKey } from "./i18n";

// Style stays here; the wording moved into i18n so the same badge can render
// in either language. Keyed lookup rather than a stored string, so a status the
// backend adds later fails loudly at the call site instead of rendering blank.
export const homeworkStatusLabel: Record<string, { key: StringKey; className: string }> = {
  not_submitted: { key: "statusNotSubmitted", className: "bg-inset text-muted" },
  pending: { key: "statusPending", className: "bg-warn-soft text-warn" },
  passed: { key: "statusPassed", className: "bg-pos-soft text-pos" },
  needs_resubmission: { key: "statusNeedsResubmission", className: "bg-neg-soft text-neg" },
};

export const accessStatusLabel: Record<string, { key: StringKey; className: string }> = {
  active: { key: "accessActive", className: "bg-pos-soft text-pos" },
  pending: { key: "accessPending", className: "bg-inset text-muted" },
  expired_pending: { key: "accessExpired", className: "bg-warn-soft text-warn" },
  revoked: { key: "accessRevoked", className: "bg-neg-soft text-neg" },
};
