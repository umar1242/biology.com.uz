import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { apiFetch, apiFetchObjectUrl, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";

type AttemptTask = {
  task_number: number;
  is_closed: boolean;
  max_points: number;
  chosen_option: string | null;
  correct_option: string | null;
  is_correct: boolean | null;
  photo_count: number;
  awarded_points: number | null;
};

type Attempt = {
  id: number;
  exam_id: number;
  exam_title: string;
  student_id: number;
  attempt_number: number;
  status: "in_progress" | "submitted" | "reviewed";
  submitted_at: string | null;
  is_late: boolean | null;
  auto_score: number | null;
  manual_score: number | null;
  total_score: number | null;
  total_max_points: number;
  review_comment_text: string | null;
  cert_estimate: CertEstimate | null;
  test_correct: number | null;
  test_half_task_count: number;
  equated: {
    status: "ok" | "not_calibrated" | "not_linked" | "below_range" | "above_range";
    measure: number | null;
    standard_error: number | null;
    equated_correct: number | null;
    reference_length: number;
    reference_exam_id: number | null;
    shared_with_reference: number;
    estimate: CertEstimate | null;
  } | null;
  tasks: AttemptTask[];
};

type CertEstimate = {
  test: number;
  written: number;
  total: number;
  percent: number;
  grade: "A+" | "A" | "B+" | "B" | "C+" | "C" | null;
};

/**
 * Поправка на трудность варианта.
 *
 * Показывается только преподавателю: два числа рядом ученик прочтёт как
 * «настоящее» и «ненастоящее», а объяснить шкалу логитов на экране мини-аппа
 * не выйдет. Преподавателю же поправка нужна сразу — по ней он сравнивает
 * потоки, писавшие разные варианты.
 */
function EquatedBlock({ attempt }: { attempt: Attempt }) {
  const { t } = useI18n();
  const e = attempt.equated;
  if (!e) return null;

  const excuse: Record<string, string> = {
    not_calibrated: t("equatedNotCalibrated", { min: 30 }),
    not_linked: t("equatedNotLinked"),
    below_range: t("equatedBelowRange"),
    above_range: t("equatedAboveRange"),
  };

  if (e.status !== "ok" || !e.estimate) {
    return (
      <div className="mb-5 rounded-2xl border border-line bg-card p-4">
        <p className="mb-1.5 text-sm font-semibold text-ink">{t("equatedTitle")}</p>
        <p className="text-xs leading-snug text-muted">{excuse[e.status] ?? "—"}</p>
      </div>
    );
  }

  const delta = attempt.cert_estimate
    ? e.estimate.total - attempt.cert_estimate.total
    : null;

  return (
    <div className="mb-5 rounded-2xl border border-line bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{t("equatedTitle")}</p>
        {delta !== null && (
          <p className={`text-xs font-medium ${delta >= 0 ? "text-pos" : "text-neg"}`}>
            {t("equatedDelta", { value: `${delta > 0 ? "+" : ""}${delta.toFixed(2)}` })}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-xs text-muted">{t("certHalfTest")}</p>
          <p className="text-lg font-semibold text-ink">{e.estimate.test}</p>
        </div>
        <div>
          <p className="text-xs text-muted">{t("certHalfWritten")}</p>
          <p className="text-lg font-semibold text-muted">{e.estimate.written}</p>
        </div>
        <div>
          <p className="text-xs text-muted">{t("certScaleTotal")}</p>
          <p className="text-lg font-semibold text-ink">
            {e.estimate.total}
            <span className="ml-2 text-base font-bold text-brand">
              {e.estimate.grade ?? t("certNoGrade")}
            </span>
          </p>
        </div>
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-xs">
        <div>
          <dt className="text-muted">{t("equatedMeasure")}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ink">
            {e.measure !== null && `${e.measure > 0 ? "+" : ""}${e.measure.toFixed(2)}`}
            {e.standard_error !== null && ` ± ${e.standard_error.toFixed(2)}`}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t("equatedSolved")}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ink">
            {t("equatedOutOf", {
              n: attempt.test_correct ?? 0,
              total: attempt.test_half_task_count,
            })}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t("equatedOnReference")}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ink">
            {t("equatedOutOf", {
              n: e.equated_correct ?? 0,
              total: e.reference_length,
            })}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs leading-snug text-muted">
        {e.reference_exam_id === attempt.exam_id
          ? t("equatedIsReference")
          : t("equatedShared", { n: e.shared_with_reference })}
        {" · "}
        {t("equatedHint")}
      </p>
    </div>
  );
}

/** Same token-protected blob loading as the homework review screen. */
function TaskPhotos({ attemptId, task, count }: { attemptId: number; task: number; count: number }) {
  const { t } = useI18n();
  const [urls, setUrls] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: string[] = [];
    Promise.all(
      Array.from({ length: count }, (_, i) =>
        apiFetchObjectUrl(`/cert-exam-attempts/${attemptId}/tasks/${task}/photos/${i}/raw`),
      ),
    )
      .then((res) => {
        created = res;
        if (!cancelled) setUrls(res);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [attemptId, task, count]);

  if (count === 0) return <p className="text-xs text-muted">{t("certPhotosNone")}</p>;
  if (failed) return <p className="text-xs text-warn">{t("photosFailed")}</p>;
  if (urls.length === 0) return <p className="text-xs text-muted">{t("loadingPhotos")}</p>;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {urls.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => setZoomed(url)}
            className="overflow-hidden rounded-xl border border-line"
          >
            <img src={url} alt={t("photoN", { n: i + 1 })} className="h-32 w-32 object-cover" />
          </button>
        ))}
      </div>
      {zoomed && (
        <div
          role="presentation"
          onClick={() => setZoomed(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
        >
          <img src={zoomed} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      )}
    </>
  );
}

export function CertAttemptPage() {
  const { id } = useParams();
  const { t, formatDateTime } = useI18n();
  const queryClient = useQueryClient();
  const [points, setPoints] = useState<Record<number, number | "">>({});
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attempt = useQuery({
    queryKey: ["cert-attempt", id],
    queryFn: () => apiFetch<Attempt>(`/cert-exam-attempts/${id}`),
  });

  useEffect(() => {
    if (!attempt.data) return;
    setPoints(
      Object.fromEntries(
        attempt.data.tasks
          .filter((x) => !x.is_closed)
          .map((x) => [x.task_number, x.awarded_points ?? ""]),
      ),
    );
    setComment(attempt.data.review_comment_text ?? "");
  }, [attempt.data]);

  const review = useMutation({
    mutationFn: () =>
      apiFetch(`/cert-exam-attempts/${id}/review`, {
        method: "POST",
        body: JSON.stringify({
          points: Object.entries(points)
            .filter(([, v]) => v !== "")
            .map(([n, v]) => ({ task_number: Number(n), awarded_points: Number(v) })),
          comment_text: comment.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      queryClient.invalidateQueries({ queryKey: ["cert-attempt", id] });
      queryClient.invalidateQueries({ queryKey: ["cert-review-queue"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "error"),
  });

  const a = attempt.data;
  const closed = a?.tasks.filter((x) => x.is_closed) ?? [];
  const open = a?.tasks.filter((x) => !x.is_closed) ?? [];
  const manualPreview = Object.values(points).reduce<number>(
    (s, v) => s + (v === "" ? 0 : Number(v)),
    0,
  );

  return (
    <>
      <TopBar title={a?.exam_title ?? t("certTitle")} backTo="/cert" />
      <main className="px-4 pb-10 sm:px-8">
        {attempt.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
        {a && (
          <>
            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-line bg-card p-4">
                <p className="text-xs text-muted">{t("certAutoPart")}</p>
                <p className="mt-1 text-2xl font-semibold text-ink">{a.auto_score ?? "—"} / 35</p>
              </div>
              <div className="rounded-2xl border border-line bg-card p-4">
                <p className="text-xs text-muted">{t("certManualPart")}</p>
                <p className="mt-1 text-2xl font-semibold text-ink">{manualPreview} / 80</p>
              </div>
              <div className="rounded-2xl border border-line bg-card p-4">
                <p className="text-xs text-muted">{t("certTotal")}</p>
                <p className="mt-1 text-2xl font-semibold text-ink">
                  {(a.auto_score ?? 0) + manualPreview} / {a.total_max_points}
                </p>
              </div>
            </div>

            {/* Shown once reviewed: the server owns this formula so the number
                the teacher sees is the same one the student is shown. */}
            {a.cert_estimate && (
              <div className="mb-5 rounded-2xl border border-line bg-card p-4">
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{t("certScaleTitle")}</p>
                  <p className="text-xs text-muted">{a.cert_estimate.percent}%</p>
                </div>
                <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                  <div>
                    <p className="text-xs text-muted">{t("certHalfTest")}</p>
                    <p className="text-lg font-semibold text-ink">{a.cert_estimate.test}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">{t("certHalfWritten")}</p>
                    <p className="text-lg font-semibold text-ink">{a.cert_estimate.written}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">{t("certScaleTotal")}</p>
                    <p className="text-lg font-semibold text-ink">
                      {a.cert_estimate.total}
                      <span className="ml-2 text-base font-bold text-brand">
                        {a.cert_estimate.grade ?? t("certNoGrade")}
                      </span>
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-snug text-muted">{t("certScaleHint")}</p>
              </div>
            )}

            {/* Второе число: та же формула, но по сумме, приведённой к шкале
                эталонного варианта. Стоит НИЖЕ официального и подписано —
                первым всегда идёт то, что считает государство. */}
            {a.equated && <EquatedBlock attempt={a} />}

            <p className="mb-4 text-xs text-muted">
              {a.submitted_at ? formatDateTime(a.submitted_at) : "—"}
              {a.is_late && ` · ${t("certLate")}`}
            </p>

            {/* Closed half: read-only, already machine-graded. */}
            <div className="mb-6 rounded-2xl border border-line bg-card p-5">
              <p className="mb-3 text-sm font-semibold text-ink">{t("certAutoPart")}</p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1.5">
                {closed.map((x) => (
                  <div
                    key={x.task_number}
                    className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs ${
                      x.is_correct === true
                        ? "bg-pos-soft text-pos"
                        : x.chosen_option === null
                          ? "bg-inset text-muted"
                          : "bg-neg-soft text-neg"
                    }`}
                  >
                    <span className="font-semibold">{x.task_number}</span>
                    <span>
                      {x.chosen_option ?? "—"}
                      {x.is_correct === false && x.correct_option && (
                        <span className="opacity-70"> → {x.correct_option}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Open half: photos + the teacher's points. */}
            <div className="flex flex-col gap-3">
              {open.map((x) => (
                <div key={x.task_number} className="rounded-2xl border border-line bg-card p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {t("certTaskN", { n: x.task_number })}
                    </p>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="number"
                        min={0}
                        max={x.max_points}
                        value={points[x.task_number] ?? ""}
                        onChange={(e) =>
                          setPoints((p) => ({
                            ...p,
                            [x.task_number]: e.target.value === "" ? "" : Number(e.target.value),
                          }))
                        }
                        className="w-20 rounded-xl border border-line px-3 py-1.5 text-sm outline-none focus:border-ink"
                      />
                      <span className="text-xs text-muted">
                        {t("certPointsOf", { max: x.max_points })}
                      </span>
                    </label>
                  </div>
                  <TaskPhotos attemptId={a.id} task={x.task_number} count={x.photo_count} />
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-line bg-card p-5">
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-ink">{t("certReviewComment")}</span>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink"
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    review.mutate();
                  }}
                  disabled={review.isPending}
                  className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
                >
                  {t("certSaveReview")}
                </button>
                {saved && <span className="text-sm text-pos">{t("certReviewSaved")}</span>}
                {error && <span className="text-sm text-neg">{error}</span>}
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
