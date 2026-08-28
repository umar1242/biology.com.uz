import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { apiFetch, ApiError } from "../lib/api";
import type { MyApplication } from "../lib/types";
import { useI18n } from "../lib/i18n";

/** Same rule as the server (routes/app/applications.ts) — at least 7 digits. */
function looksLikePhone(value: string): boolean {
  return (value.match(/\d/g) ?? []).length >= 7;
}

/**
 * One submitted questionnaire, read-only until the student presses edit.
 * Editing is limited to the answers: the course it belongs to is fixed, so
 * this can never become a way to enrol somewhere else.
 */
export function ApplicationCard({ application }: { application: MyApplication }) {
  const { t, formatDate } = useI18n();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState(application.full_name);
  const [phone, setPhone] = useState(application.phone);
  const [parentPhone, setParentPhone] = useState(application.parent_phone_primary);
  const [parentPhone2, setParentPhone2] = useState(application.parent_phone_secondary ?? "");
  const [about, setAbout] = useState(application.about_self ?? "");

  const save = useMutation({
    mutationFn: () =>
      apiFetch<MyApplication>(`/app/applications/${application.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim(),
          parent_phone_primary: parentPhone.trim(),
          parent_phone_secondary: parentPhone2.trim(),
          about_self: about.trim(),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-applications"] });
      setEditing(false);
      setSaved(true);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t("applyFailed")),
  });

  function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (fullName.trim().length < 3) return setError(t("applyErrName"));
    if (!looksLikePhone(phone)) return setError(t("applyErrPhone"));
    if (!looksLikePhone(parentPhone)) return setError(t("applyErrParent"));
    if (parentPhone2.trim() && !looksLikePhone(parentPhone2)) return setError(t("applyErrPhone"));
    save.mutate();
  }

  function cancel() {
    setFullName(application.full_name);
    setPhone(application.phone);
    setParentPhone(application.parent_phone_primary);
    setParentPhone2(application.parent_phone_secondary ?? "");
    setAbout(application.about_self ?? "");
    setError(null);
    setEditing(false);
  }

  const inputClass =
    "w-full rounded-xl border border-line bg-app px-4 py-2.5 text-sm outline-none focus:border-ink";

  return (
    <div className="border border-line rounded-card bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{application.course_title}</p>
          <p className="text-xs text-muted">
            {t("applicationSubmittedAt", { date: formatDate(application.submitted_at) })}
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted"
          >
            <Pencil size={13} /> {t("applicationEdit")}
          </button>
        )}
      </div>

      {saved && !editing && <p className="mb-2 text-xs text-pos">{t("applicationSaved")}</p>}

      {!editing ? (
        <dl className="grid grid-cols-1 gap-2 text-xs">
          <Row label={t("applyFullName")} value={application.full_name} />
          <Row label={t("applyMyPhone")} value={application.phone} />
          <Row label={t("applyParentPhone")} value={application.parent_phone_primary} />
          <Row label={t("applyParentPhoneSecond")} value={application.parent_phone_secondary} />
          <Row label={t("applyAbout")} value={application.about_self} />
        </dl>
      ) : (
        <form onSubmit={handleSave}>
          <label className="mb-3 block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-ink">{t("applyFullName")}</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
          </label>
          <label className="mb-3 block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-ink">{t("applyMyPhone")}</span>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="mb-3 block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-ink">
              {t("applyParentPhone")}
              <span className="ml-1.5 font-normal text-muted">· {t("applyRequired")}</span>
            </span>
            <input
              type="tel"
              inputMode="tel"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="mb-3 block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-ink">
              {t("applyParentPhoneSecond")}
              <span className="ml-1.5 font-normal text-muted">· {t("applyRecommended")}</span>
            </span>
            <input
              type="tel"
              inputMode="tel"
              value={parentPhone2}
              onChange={(e) => setParentPhone2(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="mb-4 block text-sm">
            <span className="mb-1.5 block text-xs font-medium text-ink">{t("applyAbout")}</span>
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              rows={3}
              className={inputClass}
            />
          </label>

          {error && <p className="mb-3 text-xs text-neg">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={save.isPending}
              className="flex-1 rounded-xl bg-brand py-2.5 text-[13px] font-semibold text-on-brand disabled:opacity-50"
            >
              {save.isPending ? t("applicationSaving") : t("applicationSave")}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="rounded-xl border border-line px-4 py-2.5 text-[13px] font-medium text-muted"
            >
              {t("applicationCancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-ink">{value || "—"}</dd>
    </div>
  );
}
