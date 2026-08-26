import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import { NotFound } from "../components/NotFound";
import { apiFetch, ApiError } from "../lib/api";
import { openBotChat } from "../lib/telegram";
import type { HomeworkDetail, Submission } from "../lib/types";
import { homeworkStatusLabel } from "../lib/statusLabels";
import { useI18n, type StringKey } from "../lib/i18n";

function Timeline({ status }: { status: string }) {
  const { t } = useI18n();
  const steps: StringKey[] = ["stepSubmitted", "stepOnReview", "stepReviewed"];
  let activeIndex = -1;
  if (status === "pending") activeIndex = 1;
  else if (status === "passed" || status === "needs_resubmission") activeIndex = 2;

  return (
    <div className="mb-6 flex items-center">
      {steps.map((key, i) => (
        <div key={key} className="flex flex-1 items-center last:flex-none">
          <div className="flex flex-col items-center">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                i <= activeIndex
                  ? "border-brand bg-brand text-on-brand"
                  : "border-line bg-card text-muted"
              }`}
            >
              {i <= activeIndex ? <Check size={14} /> : <div className="h-2 w-2 rounded-full bg-current" />}
            </div>
            <span className="mt-1.5 text-[11px] text-muted">{t(key)}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`mx-1 h-0.5 flex-1 ${i < activeIndex ? "bg-brand" : "bg-inset"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export function HomeworkDetailPage() {
  const { id } = useParams();
  const { t, formatDateTime } = useI18n();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const detail = useQuery({
    queryKey: ["homework-detail", id],
    queryFn: () => apiFetch<HomeworkDetail>(`/app/homework/${id}`),
  });
  const submissions = useQuery({
    queryKey: ["homework-submissions", id],
    queryFn: () => apiFetch<Submission[]>(`/app/homework/${id}/submissions`),
  });

  const latest = submissions.data?.[submissions.data.length - 1];
  const status = latest?.status ?? "not_submitted";
  const label = homeworkStatusLabel[status];

  const submitStart = useMutation({
    mutationFn: () => apiFetch<{ deep_link: string }>(`/app/homework/${id}/submit-start`, { method: "POST" }),
    onSuccess: (res) => {
      openBotChat(res.deep_link);
      setSent(true);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t("submitFailed")),
  });

  if (detail.isLoading) return <div className="px-5 pt-6 text-sm text-muted">{t("loading")}</div>;
  if (!detail.data) return <NotFound title={t("homeworkNotFound")} />;
  const hw = detail.data;

  return (
    <div className="px-5 pt-6">
      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="border border-line flex h-9 w-9 items-center justify-center rounded-full bg-card"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-lg font-bold text-ink">{t("homeworkOne")}</h1>
      </div>

      <div className="border border-line mb-5 flex items-center justify-between rounded-card bg-card p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-inset text-sm font-semibold text-muted">
            #{hw.id}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{hw.lesson_title}</p>
            <p className="text-xs text-muted">{hw.course_title}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${label.className}`}>
          {t(label.key)}
        </span>
      </div>

      <Timeline status={status} />

      {(status === "not_submitted" || status === "needs_resubmission") && (
        <button
          type="button"
          onClick={() => submitStart.mutate()}
          disabled={submitStart.isPending}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-card bg-brand py-3.5 text-sm font-semibold text-on-brand disabled:opacity-50"
        >
          {t("submitViaBot")}
        </button>
      )}
      {sent && <p className="mb-4 text-sm text-muted">{t("submitStarted")}</p>}
      {error && <p className="mb-4 text-sm text-neg">{error}</p>}

      <div className="border border-line mb-5 rounded-card bg-card p-4">
        <p className="mb-3 text-sm font-semibold text-ink">{t("homeworkDetails")}</p>
        <dl className="flex flex-col gap-2.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{t("deadline")}</dt>
            <dd className="text-ink">{formatDateTime(hw.deadline_at)}</dd>
          </div>
          {hw.instructions && (
            <div>
              <dt className="mb-1 text-muted">{t("task")}</dt>
              <dd className="text-ink">{hw.instructions}</dd>
            </div>
          )}
        </dl>
      </div>

      {latest?.reviewCommentText && (
        <div className="border border-line mb-5 rounded-card bg-card p-4">
          <p className="mb-2 text-sm font-semibold text-ink">{t("teacherComment")}</p>
          <p className="text-sm text-muted">{latest.reviewCommentText}</p>
        </div>
      )}
      {latest?.reviewCommentVoiceFileId && !latest.reviewCommentText && (
        <div className="border border-line mb-5 rounded-card bg-card p-4">
          <p className="text-sm font-semibold text-ink">{t("teacherVoiceComment")}</p>
          <p className="mt-1 text-xs text-muted">{t("voiceArrivesInChat")}</p>
        </div>
      )}

      {submissions.data && submissions.data.length > 0 && (
        <div className="border border-line mb-8 rounded-card bg-card p-4">
          <p className="mb-3 text-sm font-semibold text-ink">{t("submissionHistory")}</p>
          <div className="flex flex-col gap-3">
            {submissions.data.map((s) => (
              <div key={s.id} className="flex items-start gap-2.5 text-sm">
                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                <div>
                  <p className="text-ink">
                    {t("attemptN", { n: s.attemptNumber })} · {t(homeworkStatusLabel[s.status].key)}
                    {s.isLate ? t("wasLate") : ""}
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(s.submittedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
