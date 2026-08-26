import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Radio, Video } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, ApiError } from "../lib/api";
import type { Lesson } from "../lib/types";
import { useI18n } from "../lib/i18n";

export function ModuleDetailPage() {
  const { courseId, moduleId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, formatDateTime } = useI18n();

  const lessons = useQuery({
    queryKey: ["lessons", moduleId],
    queryFn: () => apiFetch<Lesson[]>(`/modules/${moduleId}/lessons`),
  });

  const [title, setTitle] = useState("");
  const [lessonType, setLessonType] = useState<"live" | "recorded">("recorded");
  const [scheduledAt, setScheduledAt] = useState("");
  const [liveCallLink, setLiveCallLink] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createLesson = useMutation({
    mutationFn: () =>
      apiFetch<Lesson>(`/modules/${moduleId}/lessons`, {
        method: "POST",
        body: JSON.stringify({
          title,
          lesson_type: lessonType,
          scheduled_at: new Date(scheduledAt).toISOString(),
          ...(lessonType === "live" && liveCallLink ? { live_call_link: liveCallLink } : {}),
        }),
      }),
    onSuccess: () => {
      setTitle("");
      setScheduledAt("");
      setLiveCallLink("");
      queryClient.invalidateQueries({ queryKey: ["lessons", moduleId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t("createLessonFailed")),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !scheduledAt) return;
    createLesson.mutate();
  }

  return (
    <>
      <TopBar title={t("lessons")} backTo={`/courses/${courseId}`} />
      <main className="px-4 pb-10 sm:px-8">
        <form onSubmit={handleCreate} className="border border-line mb-6 flex flex-col gap-3 rounded-2xl bg-card p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex-1 min-w-[200px] text-sm">
              <span className="mb-1.5 block font-medium text-ink">{t("lessonTitle")}</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder=""
                className="w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1.5 block font-medium text-ink">{t("lessonType")}</span>
              <select
                value={lessonType}
                onChange={(e) => setLessonType(e.target.value as "live" | "recorded")}
                className="rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
              >
                <option value="recorded">{t("lessonRecorded")}</option>
                <option value="live">{t("lessonLive")}</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1.5 block font-medium text-ink">
                {lessonType === "live" ? t("airTime") : t("plannedPublish")}
              </span>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
              />
            </label>
          </div>
          {lessonType === "live" && (
            <label className="text-sm">
              <span className="mb-1.5 block font-medium text-ink">
                {t("callLinkOptional")}
              </span>
              <input
                value={liveCallLink}
                onChange={(e) => setLiveCallLink(e.target.value)}
                placeholder="https://meet.google.com/..."
                className="w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={createLesson.isPending}
            className="flex w-fit items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={16} /> {t("addLesson")}
          </button>
        </form>
        {error && <p className="mb-4 text-sm text-neg">{error}</p>}

        <div className="flex flex-col gap-2">
          {lessons.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
          {lessons.data?.length === 0 && (
            <p className="text-sm text-muted">{t("noLessonsCreateFirst")}</p>
          )}
          {lessons.data?.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => navigate(`/lessons/${l.id}`)}
              className="border border-line flex items-center gap-3 rounded-2xl bg-card p-4 text-left "
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-inset text-muted">
                {l.lessonType === "live" ? <Radio size={16} /> : <Video size={16} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{l.title}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(l.scheduledAt)}
                  {!l.isPublished && t("draftSuffix")}
                </p>
              </div>
            </button>
          ))}
        </div>
      </main>
    </>
  );
}
