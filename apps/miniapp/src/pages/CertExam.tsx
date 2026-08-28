import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Camera, Check, FileDown, Send } from "lucide-react";
import { apiFetch } from "../lib/api";
import { errorText } from "../lib/errorText";
import { closeMiniApp, openBotChat } from "../lib/telegram";
import { useI18n } from "../lib/i18n";

type Task = {
  task_number: number;
  is_closed: boolean;
  options: string[];
  max_points: number;
  chosen_option: string | null;
  photo_count: number;
  is_correct: boolean | null;
  awarded_points: number | null;
};

type Attempt = {
  id: number;
  exam_title: string;
  status: "in_progress" | "submitted" | "reviewed";
  submitted_at: string | null;
  is_late: boolean | null;
  auto_score: number | null;
  manual_score: number | null;
  total_score: number | null;
  total_max_points: number;
  review_comment_text: string | null;
  tasks: Task[];
};

type ExamDetail = {
  id: number;
  title: string;
  deadline_at: string;
  has_variant_file: boolean;
  attempt_id: number | null;
  attempt_status: string | null;
};

/** Debounced autosave: tapping through 35 options shouldn't be 35 requests. */
const SAVE_DEBOUNCE_MS = 700;

export function CertExamPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved">("idle");
  const [fileSent, setFileSent] = useState(false);
  const pendingRef = useRef<Record<number, string | null>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const exam = useQuery({
    queryKey: ["cert-exam", id],
    queryFn: () => apiFetch<ExamDetail>(`/app/cert-exams/${id}`),
  });

  const start = useMutation({
    mutationFn: () =>
      apiFetch<{ id: number }>(`/app/cert-exams/${id}/start`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cert-exam", id] });
      queryClient.invalidateQueries({ queryKey: ["cert-exams"] });
    },
    onError: (e) => setError(errorText(e, t("frozenText"), t("applyFailed"))),
  });

  const attemptId = exam.data?.attempt_id ?? null;

  const attempt = useQuery({
    queryKey: ["cert-attempt", attemptId],
    queryFn: () => apiFetch<Attempt>(`/app/cert-exam-attempts/${attemptId}`),
    enabled: attemptId !== null,
  });

  // Local echo of picks so the grid reacts instantly while the save is in
  // flight — refetching on every tap would make the UI feel laggy.
  const [local, setLocal] = useState<Record<number, string | null>>({});
  useEffect(() => {
    if (!attempt.data) return;
    setLocal(
      Object.fromEntries(
        attempt.data.tasks.filter((x) => x.is_closed).map((x) => [x.task_number, x.chosen_option]),
      ),
    );
  }, [attempt.data]);

  const saveAnswers = useMutation({
    mutationFn: (answers: { task_number: number; chosen_option: string | null }[]) =>
      apiFetch(`/app/cert-exam-attempts/${attemptId}/answers`, {
        method: "PUT",
        body: JSON.stringify({ answers }),
      }),
    onSuccess: () => {
      setSavingState("saved");
      setTimeout(() => setSavingState("idle"), 1500);
    },
    onError: (e) => setError(errorText(e, t("frozenText"), t("applyFailed"))),
  });

  function pick(task: number, option: string) {
    const next = local[task] === option ? null : option; // tapping again clears
    setLocal((l) => ({ ...l, [task]: next }));
    pendingRef.current[task] = next;
    setSavingState("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const batch = Object.entries(pendingRef.current).map(([n, v]) => ({
        task_number: Number(n),
        chosen_option: v,
      }));
      pendingRef.current = {};
      if (batch.length > 0) saveAnswers.mutate(batch);
    }, SAVE_DEBOUNCE_MS);
  }

  const photoStart = useMutation({
    mutationFn: (task: number) =>
      apiFetch<{ deep_link: string }>(
        `/app/cert-exam-attempts/${attemptId}/tasks/${task}/photo-start`,
        { method: "POST" },
      ),
    onSuccess: (res) => openBotChat(res.deep_link),
    onError: (e) => setError(errorText(e, t("frozenText"), t("applyFailed"))),
  });

  const submit = useMutation({
    mutationFn: () =>
      apiFetch(`/app/cert-exam-attempts/${attemptId}/submit`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cert-attempt", attemptId] });
      queryClient.invalidateQueries({ queryKey: ["cert-exam", id] });
      queryClient.invalidateQueries({ queryKey: ["cert-exams"] });
    },
    onError: (e) => setError(errorText(e, t("frozenText"), t("applyFailed"))),
  });

  const a = attempt.data;
  const closed = useMemo(() => a?.tasks.filter((x) => x.is_closed) ?? [], [a]);
  const open = useMemo(() => a?.tasks.filter((x) => !x.is_closed) ?? [], [a]);
  const answered = Object.values(local).filter(Boolean).length;
  const editable = a?.status === "in_progress";

  // Telegram's WebView blocks window.open on blob: URLs, so fetching the
  // token-protected file and opening it in-page silently did nothing on a
  // phone. The bot pushes it into the student's own chat instead.
  const sendFile = useMutation({
    mutationFn: () =>
      apiFetch<{ sent: boolean }>(`/app/cert-exams/${id}/variant-file/send`, { method: "POST" }),
    onSuccess: () => {
      setFileSent(true);
      setTimeout(() => setFileSent(false), 6000);
    },
    onError: (e) => setError(errorText(e, t("frozenText"), t("applyFailed"))),
  });

  return (
    <div className="px-5 pt-6">
      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/cert")}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="truncate text-lg font-bold text-ink">
          {exam.data?.title ?? t("certListTitle")}
        </h1>
      </div>
      <div className="flex flex-col gap-3 pb-8">
        {exam.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}

        {exam.data?.has_variant_file &&
          (fileSent ? (
            <button
              type="button"
              onClick={closeMiniApp}
              className="flex items-center justify-center gap-2 rounded-2xl bg-pos-soft p-3.5 text-sm font-semibold text-pos"
            >
              <Check size={16} /> {t("certFileSent")} · {t("certOpenChat")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(null);
                sendFile.mutate();
              }}
              disabled={sendFile.isPending}
              className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-card p-3.5 text-sm font-semibold text-ink disabled:opacity-50"
            >
              <FileDown size={16} /> {t("certSendFile")}
            </button>
          ))}

        {attemptId === null && (
          <button
            type="button"
            onClick={() => start.mutate()}
            disabled={start.isPending}
            className="rounded-2xl bg-brand p-4 text-sm font-semibold text-on-brand disabled:opacity-50"
          >
            {t("certStart")}
          </button>
        )}

        {a?.status === "reviewed" && (
          <div className="rounded-2xl border border-line bg-card p-4">
            <p className="mb-3 text-sm font-semibold text-ink">{t("certResultTitle")}</p>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-muted">{t("certAutoScore")}</p>
                <p className="text-lg font-semibold text-ink">{a.auto_score} / 35</p>
              </div>
              <div>
                <p className="text-xs text-muted">{t("certManualScore")}</p>
                <p className="text-lg font-semibold text-ink">{a.manual_score} / 80</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted">{t("certTotalScore")}</p>
                <p className="text-2xl font-bold text-brand">
                  {a.total_score}
                  <span className="text-sm font-medium text-muted">/{a.total_max_points}</span>
                </p>
              </div>
            </div>
            {a.review_comment_text && (
              <div className="mt-3 rounded-xl bg-inset p-3">
                <p className="text-xs font-medium text-muted">{t("certTeacherComment")}</p>
                <p className="mt-1 text-sm text-ink">{a.review_comment_text}</p>
              </div>
            )}
          </div>
        )}

        {a?.status === "submitted" && (
          <div className="rounded-2xl bg-warn-soft p-4 text-sm font-medium text-warn">
            {t("certWaitingReview")}
          </div>
        )}

        {a && (
          <>
            <div className="rounded-2xl border border-line bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">{t("certClosedPart")}</p>
                <span className="text-xs text-muted">
                  {savingState === "saving"
                    ? t("certSaving")
                    : savingState === "saved"
                      ? t("certSavedOk")
                      : t("certAnswered", { n: answered })}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                {closed.map((x) => (
                  <div key={x.task_number} className="flex items-center gap-2">
                    <span
                      className={`w-7 shrink-0 text-xs font-semibold ${
                        x.task_number >= 33 ? "text-brand" : "text-muted"
                      }`}
                    >
                      {x.task_number}
                    </span>
                    <div className="flex flex-1 gap-1">
                      {x.options.map((o) => {
                        const picked = local[x.task_number] === o;
                        const graded = a.status === "reviewed";
                        return (
                          <button
                            key={o}
                            type="button"
                            disabled={!editable}
                            onClick={() => pick(x.task_number, o)}
                            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
                              picked
                                ? graded
                                  ? x.is_correct
                                    ? "bg-pos text-white"
                                    : "bg-neg text-white"
                                  : "bg-brand text-on-brand"
                                : "bg-inset text-muted"
                            } ${!editable ? "opacity-80" : ""}`}
                          >
                            {o}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-card p-4">
              <p className="mb-3 text-sm font-semibold text-ink">{t("certOpenPart")}</p>
              <div className="flex flex-col gap-2">
                {open.map((x) => (
                  <div
                    key={x.task_number}
                    className="flex items-center justify-between gap-2 rounded-xl bg-inset p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {t("certTaskShort", { n: x.task_number })}
                        <span className="ml-2 text-xs font-normal text-muted">
                          {t("certMaxPoints", { n: x.max_points })}
                        </span>
                      </p>
                      <p className="text-xs text-muted">
                        {x.photo_count > 0
                          ? t("certPhotoSent", { n: x.photo_count })
                          : t("certPhotoNone")}
                        {a.status === "reviewed" && x.awarded_points !== null && (
                          <span className="ml-2 font-semibold text-ink">
                            {x.awarded_points}/{x.max_points}
                          </span>
                        )}
                      </p>
                    </div>
                    {editable && (
                      <button
                        type="button"
                        onClick={() => photoStart.mutate(x.task_number)}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl bg-card px-3 py-2 text-xs font-semibold text-ink"
                      >
                        {x.photo_count > 0 ? <Check size={13} /> : <Camera size={13} />}
                        {t("certSendPhoto")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {editable && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t("certSubmitConfirm"))) submit.mutate();
                }}
                disabled={submit.isPending}
                className="flex items-center justify-center gap-2 rounded-2xl bg-brand p-4 text-sm font-semibold text-on-brand disabled:opacity-50"
              >
                <Send size={16} /> {t("certSubmit")}
              </button>
            )}
          </>
        )}

        {error && <p className="text-xs text-neg">{error}</p>}
      </div>
    </div>
  );
}
