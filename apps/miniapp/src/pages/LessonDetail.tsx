import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, PlayCircle } from "lucide-react";
import { NotFound } from "../components/NotFound";
import { apiFetch } from "../lib/api";
import { errorText } from "../lib/errorText";
import type { LessonDetail } from "../lib/types";
import { useI18n } from "../lib/i18n";

export function LessonDetailPage() {
  const { t, formatDateTime } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);

  const lesson = useQuery({
    queryKey: ["lesson", id],
    queryFn: () => apiFetch<LessonDetail>(`/app/lessons/${id}`),
  });

  const requestVideo = useMutation({
    mutationFn: () => apiFetch<{ status: string }>(`/app/lessons/${id}/request-video`, { method: "POST" }),
    onSuccess: () => setMessage(t("videoSentToChat")),
    onError: (err) => setMessage(errorText(err, t("frozenText"), t("videoSendFailed"))),
  });

  if (lesson.isLoading) return <div className="px-5 pt-6 text-sm text-muted">{t("loading")}</div>;
  if (!lesson.data) return <NotFound title={t("lessonNotFound")} />;
  const l = lesson.data;

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
        <h1 className="truncate text-lg font-bold text-ink">{l.title}</h1>
      </div>

      <div className="border border-line mb-5 rounded-card bg-card p-4">
        <p className="text-xs text-muted">
          {l.lesson_type === "live" ? t("lessonLive") : t("lessonRecorded")} ·{" "}
          {new Date(l.scheduled_at).toLocaleString("ru-RU")}
        </p>
        {l.description && <p className="mt-2 text-sm text-ink">{l.description}</p>}
      </div>

      {l.lesson_type === "live" && l.live_call_link && (
        <a
          href={l.live_call_link}
          target="_blank"
          rel="noreferrer"
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-card bg-brand py-3.5 text-sm font-semibold text-on-brand"
        >
          {t("joinCall")}
        </a>
      )}

      <button
        type="button"
        onClick={() => requestVideo.mutate()}
        disabled={!l.has_recording || requestVideo.isPending}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-card bg-brand py-3.5 text-sm font-semibold text-on-brand disabled:opacity-40"
      >
        <PlayCircle size={16} />
        {l.has_recording ? t("getVideoInChat") : t("noRecordingYet")}
      </button>
      {message && <p className="mb-4 text-sm text-muted">{message}</p>}

      {l.materials.length > 0 && (
        <div className="border border-line rounded-card bg-card p-4">
          <p className="mb-3 text-sm font-semibold text-ink">{t("materials")}</p>
          <div className="flex flex-col gap-2">
            {l.materials.map((m) => (
              <div key={m.index} className="text-sm text-ink">
                {m.material_type === "text" ? m.text_content : (m.file_name ?? m.caption)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
