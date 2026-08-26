import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Mic, RotateCcw, X } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, apiFetchObjectUrl, ApiError } from "../lib/api";
import type { ReviewQueueItem } from "../lib/types";
import { claimDeepLinkTab } from "../lib/telegramLink";
import { DeepLinkNotice } from "../components/DeepLinkNotice";
import { useI18n } from "../lib/i18n";

const filters = [
  { key: "pending", labelKey: "filterPending" },
  { key: "all", labelKey: "all" },
] as const;

/**
 * The submitted photos are the whole point of the review screen — without
 * them the teacher was being asked to pass or fail work they could not see.
 * They can't be plain <img src> tags: the raw endpoint is token-protected,
 * so each one is fetched as a blob and shown from an object URL.
 */
function SubmissionPhotos({ submissionId, count }: { submissionId: number; count: number }) {
  const { t } = useI18n();
  const [urls, setUrls] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: string[] = [];

    Promise.all(
      Array.from({ length: count }, (_, i) =>
        apiFetchObjectUrl(`/submissions/${submissionId}/photos/${i}/raw`),
      ),
    )
      .then((res) => {
        created = res;
        if (cancelled) return;
        setUrls(res);
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [submissionId, count]);

  if (count === 0) return null;
  if (failed) {
    return <p className="text-xs text-warn">{t("photosFailed")}</p>;
  }
  if (urls.length === 0) {
    return <p className="text-xs text-muted">{t("loadingPhotos")}</p>;
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {urls.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => setZoomed(url)}
            className="overflow-hidden rounded-xl border border-line transition-shadow "
            title={t("photoZoomHint", { n: i + 1 })}
          >
            <img src={url} alt={t("photoN", { n: i + 1 })} className="h-28 w-28 object-cover" />
          </button>
        ))}
      </div>

      {zoomed && (
        <div
          role="presentation"
          onClick={() => setZoomed(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
        >
          <img src={zoomed} alt={t("submissionPhoto")} className="max-h-full max-w-full rounded-xl object-contain" />
          <button
            type="button"
            onClick={() => setZoomed(null)}
            className="border border-line absolute top-5 right-5 flex h-10 w-10 items-center justify-center rounded-full bg-card/15 text-on-brand hover:bg-card/25"
            aria-label={t("close")}
          >
            <X size={20} />
          </button>
        </div>
      )}
    </>
  );
}

function ReviewRow({ item }: { item: ReviewQueueItem }) {
  const { t, formatDateTime } = useI18n();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [voiceLink, setVoiceLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["review-queue"] });

  const review = useMutation({
    mutationFn: (status: "passed" | "needs_resubmission") =>
      apiFetch(`/submissions/${item.id}/review`, {
        method: "POST",
        body: JSON.stringify({ status, comment_text: comment || undefined }),
      }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : t("reviewSaveFailed")),
  });

  const startVoice = useMutation({
    mutationFn: () =>
      apiFetch<{ deep_link: string }>(`/submissions/${item.id}/review/voice-start`, { method: "POST" }),
    onError: (err) => setError(err instanceof ApiError ? err.message : t("voiceStartFailed")),
  });

  function startVoiceComment() {
    setError(null);
    const tab = claimDeepLinkTab();
    startVoice.mutate(undefined, {
      onSuccess: (res) => {
        setVoiceLink(res.deep_link);
        tab.navigate(res.deep_link);
      },
      onError: () => tab.cancel(),
    });
  }

  return (
    <div className="border border-line flex flex-col gap-3 rounded-2xl bg-card p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-inset text-sm font-semibold text-muted">
          №{item.studentId}
        </div>
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-sm font-semibold text-ink">
            {t("homeworkAttempt", { id: item.homeworkId, n: item.attemptNumber })}
          </p>
          <p className="text-xs text-muted">
            {formatDateTime(item.submittedAt)} · {t("photosCount", { count: item.photoFileIds.length })}
          </p>
        </div>
        {item.isLate && (
          <span className="shrink-0 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn">
            {t("late")}
          </span>
        )}
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            item.status === "pending"
              ? "bg-inset text-muted"
              : item.status === "passed"
                ? "bg-pos-soft text-pos"
                : "bg-neg-soft text-neg"
          }`}
        >
          {item.status === "pending" ? t("statusPending") : item.status === "passed" ? t("statusPassed") : t("statusRejected")}
        </span>
      </div>

      <SubmissionPhotos submissionId={item.id} count={item.photoFileIds.length} />

      {item.status === "pending" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("commentOptional")}
              className="w-full min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink sm:w-auto sm:min-w-[220px]"
            />
            <button
              type="button"
              onClick={startVoiceComment}
              disabled={startVoice.isPending}
              className="flex items-center gap-1.5 rounded-xl bg-inset px-3 py-2 text-xs font-semibold text-ink hover:bg-inset disabled:opacity-50"
            >
              <Mic size={13} /> {t("voiceComment")}
            </button>
            <button
              type="button"
              onClick={() => review.mutate("passed")}
              disabled={review.isPending}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-pos-soft text-pos hover:bg-pos-soft disabled:opacity-50"
              title={t("accept")}
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              onClick={() => review.mutate("needs_resubmission")}
              disabled={review.isPending}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-neg-soft text-neg hover:bg-neg-soft disabled:opacity-50"
              title={t("reject")}
            >
              <RotateCcw size={16} />
            </button>
          </div>
          {voiceLink && (
            <DeepLinkNotice
              url={voiceLink}
              hint={t("voiceHint")}
            />
          )}
          {error && <p className="text-xs text-neg">{error}</p>}
        </>
      )}

      {item.status !== "pending" && (item.reviewCommentText || item.reviewCommentVoiceFileId) && (
        <p className="text-xs text-muted">
          {item.reviewCommentText ?? t("voiceLeft")}
        </p>
      )}
    </div>
  );
}

export function ReviewPage() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<(typeof filters)[number]["key"]>("pending");

  const queue = useQuery({
    queryKey: ["review-queue", filter],
    queryFn: () =>
      apiFetch<ReviewQueueItem[]>(filter === "pending" ? "/review-queue?status=pending" : "/review-queue"),
  });

  return (
    <>
      <TopBar title={t("review")} />
      <main className="px-4 pb-10 sm:px-8">
        <div className="mb-5 flex gap-2">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                filter === f.key
                  ? "bg-brand text-on-brand"
                  : "bg-card text-muted hover:text-ink"
              }`}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          {queue.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
          {queue.data?.length === 0 && (
            <p className="text-sm text-muted">{t("queueEmpty")}</p>
          )}
          {queue.data?.map((item) => (
            <ReviewRow key={item.id} item={item} />
          ))}
        </div>
      </main>
    </>
  );
}
