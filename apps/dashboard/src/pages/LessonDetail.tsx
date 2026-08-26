import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { CheckCircle2, Video } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, ApiError } from "../lib/api";
import { claimDeepLinkTab } from "../lib/telegramLink";
import { DeepLinkNotice } from "../components/DeepLinkNotice";
import type { Homework, Lesson } from "../lib/types";
import { useI18n } from "../lib/i18n";

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LessonDetailPage() {
  const { t, formatDateTime } = useI18n();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [videoLink, setVideoLink] = useState<string | null>(null);

  const lesson = useQuery({ queryKey: ["lesson", id], queryFn: () => apiFetch<Lesson>(`/lessons/${id}`) });
  const homework = useQuery({
    queryKey: ["lesson-homework", id],
    queryFn: () => apiFetch<Homework | null>(`/lessons/${id}/homework`),
  });

  const [scheduledAt, setScheduledAt] = useState("");
  const [liveCallLink, setLiveCallLink] = useState("");
  useEffect(() => {
    if (lesson.data) {
      setScheduledAt(toLocalInputValue(lesson.data.scheduledAt));
      setLiveCallLink(lesson.data.liveCallLink ?? "");
    }
  }, [lesson.data]);

  const saveLesson = useMutation({
    mutationFn: () =>
      apiFetch<Lesson>(`/lessons/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          scheduled_at: new Date(scheduledAt).toISOString(),
          ...(lesson.data?.lessonType === "live" ? { live_call_link: liveCallLink } : {}),
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lesson", id] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : t("saveFailed")),
  });

  const publish = useMutation({
    mutationFn: () => apiFetch<Lesson>(`/lessons/${id}/publish`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lesson", id] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : t("publishFailed")),
  });

  const attachVideo = useMutation({
    mutationFn: () => apiFetch<{ deep_link: string }>(`/lessons/${id}/attach-video-start`, { method: "POST" }),
    onError: (err) => setError(err instanceof ApiError ? err.message : t("attachVideoFailed")),
  });

  function startAttachVideo() {
    setError(null);
    const tab = claimDeepLinkTab();
    attachVideo.mutate(undefined, {
      onSuccess: (res) => {
        setVideoLink(res.deep_link);
        tab.navigate(res.deep_link);
      },
      onError: () => tab.cancel(),
    });
  }

  const [hwInstructions, setHwInstructions] = useState("");
  const [hwDeadline, setHwDeadline] = useState("");
  useEffect(() => {
    if (homework.data) {
      setHwInstructions(homework.data.instructions ?? "");
      setHwDeadline(toLocalInputValue(homework.data.deadlineAt));
    }
  }, [homework.data]);

  const saveHomework = useMutation({
    mutationFn: () =>
      homework.data
        ? apiFetch<Homework>(`/homework/${homework.data.id}`, {
            method: "PATCH",
            body: JSON.stringify({ instructions: hwInstructions, deadline_at: new Date(hwDeadline).toISOString() }),
          })
        : apiFetch<Homework>(`/lessons/${id}/homework`, {
            method: "POST",
            body: JSON.stringify({ instructions: hwInstructions, deadline_at: new Date(hwDeadline).toISOString() }),
          }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lesson-homework", id] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : t("saveHomeworkFailed")),
  });

  function handleSaveHomework(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!hwDeadline) return;
    saveHomework.mutate();
  }

  if (lesson.isLoading) return <div className="px-4 pt-8 text-sm text-muted sm:px-8">{t("loading")}</div>;
  if (!lesson.data) return null;
  const l = lesson.data;
  const hasVideo = l.lessonType === "live" ? !!l.liveRecordingFileId : !!l.recordedVideoFileId;

  return (
    <>
      <TopBar title={l.title} />
      <main className="max-w-2xl px-4 pb-10 sm:px-8">
        {error && <p className="mb-4 text-sm text-neg">{error}</p>}

        <div className="mb-6 flex items-center gap-3">
          <span className="rounded-full bg-inset px-3 py-1.5 text-xs font-medium text-muted">
            {l.lessonType === "live" ? t("lessonLiveFull") : t("lessonRecorded")}
          </span>
          {l.isPublished ? (
            <span className="flex items-center gap-1 rounded-full bg-pos-soft px-3 py-1.5 text-xs font-medium text-pos">
              <CheckCircle2 size={13} /> {t("published")}
            </span>
          ) : (
            <>
              <span className="rounded-full bg-inset px-3 py-1.5 text-xs font-medium text-muted">
                {t("draft")}
              </span>
              <button
                type="button"
                onClick={() => publish.mutate()}
                disabled={publish.isPending}
                className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
              >
                {t("publish")}
              </button>
            </>
          )}
        </div>

        <div className="border border-line mb-6 rounded-2xl bg-card p-5">
          <p className="mb-3 text-sm font-semibold text-ink">{t("schedule")}</p>
          <label className="mb-3 block text-sm">
            <span className="mb-1.5 block font-medium text-ink">
              {l.lessonType === "live" ? t("airTime") : t("plannedPublish")}
            </span>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>
          {l.lessonType === "live" && (
            <label className="mb-3 block text-sm">
              <span className="mb-1.5 block font-medium text-ink">{t("callLink")}</span>
              <input
                value={liveCallLink}
                onChange={(e) => setLiveCallLink(e.target.value)}
                placeholder="https://meet.google.com/..."
                className="w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
              />
            </label>
          )}
          <button
            type="button"
            onClick={() => saveLesson.mutate()}
            disabled={saveLesson.isPending}
            className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
          >
            {t("save")}
          </button>
        </div>

        <div className="border border-line mb-6 rounded-2xl bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">{t("video")}</p>
            {hasVideo ? (
              <span className="rounded-full bg-pos-soft px-2.5 py-1 text-xs font-medium text-pos">
                {t("uploaded")}
              </span>
            ) : (
              <span className="rounded-full bg-inset px-2.5 py-1 text-xs font-medium text-muted">
                {l.lessonType === "live" ? t("noRecording") : t("notUploaded")}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={startAttachVideo}
            disabled={attachVideo.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
          >
            <Video size={15} /> {hasVideo ? t("replaceVideo") : t("attachVideo")}
          </button>
          {videoLink && (
            <DeepLinkNotice
              url={videoLink}
              hint={t("attachVideoHint")}
            />
          )}
        </div>

        <form onSubmit={handleSaveHomework} className="border border-line rounded-2xl bg-card p-5">
          <p className="mb-3 text-sm font-semibold text-ink">{t("homework")}</p>
          <label className="mb-3 block text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("deadline")}</span>
            <input
              type="datetime-local"
              value={hwDeadline}
              onChange={(e) => setHwDeadline(e.target.value)}
              className="rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="mb-4 block text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("task")}</span>
            <textarea
              value={hwInstructions}
              onChange={(e) => setHwInstructions(e.target.value)}
              rows={3}
              placeholder=""
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>
          <button
            type="submit"
            disabled={saveHomework.isPending}
            className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
          >
            {homework.data ? t("save") : t("createHomework")}
          </button>
        </form>
      </main>
    </>
  );
}
