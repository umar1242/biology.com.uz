import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, ShieldOff, ShieldPlus, UserPlus, UserX } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, ApiError } from "../lib/api";
import type { Course, RosterStudent } from "../lib/types";
import { useI18n, type StringKey } from "../lib/i18n";

function accessLabel(s: RosterStudent): { key: StringKey; className: string } {
  if (s.revoked) return { key: "accessRevoked", className: "bg-neg-soft text-neg" };
  if (!s.access_granted) return { key: "accessPending", className: "bg-inset text-muted" };
  if (s.expires_at && new Date(s.expires_at).getTime() < Date.now()) {
    return { key: "accessExpired", className: "bg-warn-soft text-warn" };
  }
  return { key: "accessActive", className: "bg-pos-soft text-pos" };
}

function toDateInputValue(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function StudentCard({ student, courseId }: { student: RosterStudent; courseId: number }) {
  const queryClient = useQueryClient();
  const { t, formatDate } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [expiryDraft, setExpiryDraft] = useState(toDateInputValue(student.expires_at));
  const [showExpiryInput, setShowExpiryInput] = useState(false);
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [reason, setReason] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["roster", courseId] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
  };

  const onErr = (err: unknown, fallback: string) =>
    setError(err instanceof ApiError ? err.message : fallback);

  const active = student.access_granted && !student.revoked;

  const grantOrExtend = useMutation({
    mutationFn: () =>
      apiFetch(`/courses/${courseId}/students/${student.student_id}/access`, {
        method: active ? "PATCH" : "POST",
        body: JSON.stringify({ expires_at: new Date(expiryDraft).toISOString() }),
      }),
    onSuccess: () => {
      setShowExpiryInput(false);
      invalidate();
    },
    onError: (err) => onErr(err, t("grantFailed")),
  });

  const revoke = useMutation({
    mutationFn: () =>
      apiFetch(`/courses/${courseId}/students/${student.student_id}/access/revoke`, { method: "POST" }),
    onSuccess: invalidate,
    onError: (err) => onErr(err, t("revokeFailed")),
  });

  const resetPoints = useMutation({
    mutationFn: () =>
      apiFetch(`/courses/${courseId}/students/${student.student_id}/penalty/reset`, { method: "POST" }),
    onSuccess: invalidate,
    onError: (err) => onErr(err, t("resetPointsFailed")),
  });

  const blacklist = useMutation({
    mutationFn: () =>
      apiFetch(`/courses/${courseId}/students/${student.student_id}/blacklist`, {
        method: "POST",
        body: JSON.stringify({ reason: reason || undefined }),
      }),
    onSuccess: () => {
      setShowReasonInput(false);
      setReason("");
      invalidate();
    },
    onError: (err) => onErr(err, t("blockFailed")),
  });

  const clearBlacklist = useMutation({
    mutationFn: () =>
      apiFetch(`/courses/${courseId}/students/${student.student_id}/blacklist/clear`, { method: "POST" }),
    onSuccess: invalidate,
    onError: (err) => onErr(err, t("unblockFailed")),
  });

  const label = accessLabel(student);

  return (
    <div className="border border-line rounded-2xl bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">{student.first_name}</p>
          {student.telegram_username && (
            <p className="text-xs text-muted">@{student.telegram_username}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${label.className}`}>{t(label.key)}</span>
          {student.is_blacklisted && (
            <span className="rounded-full bg-neg-soft px-2.5 py-1 text-xs font-medium text-neg">
              {t("blacklisted")}
            </span>
          )}
        </div>
      </div>

      {error && <p className="mb-3 text-xs text-neg">{error}</p>}

      <div className="mb-3 grid grid-cols-2 gap-3 text-xs text-muted sm:grid-cols-4">
        <div>
          <p className="text-muted">{t("progress")}</p>
          <p className="text-sm font-medium text-ink">
            {student.progress_summary.homework_passed}/{student.progress_summary.homework_total}
          </p>
        </div>
        <div>
          <p className="text-muted">{t("points")}</p>
          <p className="text-sm font-medium text-ink">{student.penalty_points}</p>
        </div>
        <div className="col-span-2">
          <p className="text-muted">{t("accessUntil")}</p>
          <p className="text-sm font-medium text-ink">
            {student.expires_at ? formatDate(student.expires_at) : "—"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!showExpiryInput ? (
          <button
            type="button"
            onClick={() => setShowExpiryInput(true)}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-on-brand hover:opacity-90"
          >
            <UserPlus size={13} /> {active ? t("extendAccess") : t("grantAccess")}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              value={expiryDraft}
              onChange={(e) => setExpiryDraft(e.target.value)}
              className="rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-ink"
            />
            <button
              type="button"
              onClick={() => grantOrExtend.mutate()}
              disabled={grantOrExtend.isPending}
              className="rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand disabled:opacity-50"
            >
              OK
            </button>
            <button
              type="button"
              onClick={() => setShowExpiryInput(false)}
              className="rounded-lg px-2 py-1.5 text-xs text-muted"
            >
              {t("cancel")}
            </button>
          </div>
        )}

        {active && (
          <button
            type="button"
            onClick={() => revoke.mutate()}
            disabled={revoke.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-neg-soft px-3 py-2 text-xs font-semibold text-neg hover:bg-neg-soft disabled:opacity-50"
          >
            <UserX size={13} /> {t("revokeAccess")}
          </button>
        )}

        {student.penalty_points > 0 && (
          <button
            type="button"
            onClick={() => resetPoints.mutate()}
            disabled={resetPoints.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-inset px-3 py-2 text-xs font-semibold text-ink hover:bg-inset disabled:opacity-50"
          >
            <RotateCcw size={13} /> {t("resetPoints")}
          </button>
        )}

        {student.is_blacklisted ? (
          <button
            type="button"
            onClick={() => clearBlacklist.mutate()}
            disabled={clearBlacklist.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-pos-soft px-3 py-2 text-xs font-semibold text-pos hover:bg-pos-soft disabled:opacity-50"
          >
            <ShieldPlus size={13} /> {t("unblockStudent")}
          </button>
        ) : !showReasonInput ? (
          <button
            type="button"
            onClick={() => setShowReasonInput(true)}
            className="flex items-center gap-1.5 rounded-xl bg-inset px-3 py-2 text-xs font-semibold text-ink hover:bg-inset"
          >
            <ShieldOff size={13} /> {t("blockStudent")}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonOptional")}
              className="rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-ink"
            />
            <button
              type="button"
              onClick={() => blacklist.mutate()}
              disabled={blacklist.isPending}
              className="rounded-lg bg-neg px-2.5 py-1.5 text-xs font-semibold text-on-brand disabled:opacity-50"
            >
              {t("blockStudent")}
            </button>
            <button
              type="button"
              onClick={() => setShowReasonInput(false)}
              className="rounded-lg px-2 py-1.5 text-xs text-muted"
            >
              {t("cancel")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function StudentsPage() {
  const { t } = useI18n();
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => apiFetch<Course[]>("/courses") });
  const [courseId, setCourseId] = useState<number | null>(null);

  useEffect(() => {
    if (courseId === null && courses.data?.[0]) setCourseId(courses.data[0].id);
  }, [courses.data, courseId]);

  const roster = useQuery({
    queryKey: ["roster", courseId],
    queryFn: () => apiFetch<RosterStudent[]>(`/courses/${courseId}/students`),
    enabled: courseId !== null,
  });

  return (
    <>
      <TopBar title={t("students")} />
      <main className="px-4 pb-10 sm:px-8">
        <div className="mb-5">
          <select
            value={courseId ?? ""}
            onChange={(e) => setCourseId(Number(e.target.value))}
            className="rounded-xl border border-line bg-card px-4 py-2.5 text-sm outline-none focus:border-ink"
          >
            {courses.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-3">
          {roster.data?.length === 0 && (
            <p className="text-sm text-muted">{t("noStudentsOnCourse")}</p>
          )}
          {courseId !== null &&
            roster.data?.map((s) => <StudentCard key={s.student_id} student={s} courseId={courseId} />)}
        </div>
      </main>
    </>
  );
}
