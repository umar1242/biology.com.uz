import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Radio, Video } from "lucide-react";
import { apiFetch } from "../lib/api";
import type { LessonListItem } from "../lib/types";
import { useI18n } from "../lib/i18n";

export function LessonsPage() {
  const { t, formatDateTime, formatDate } = useI18n();
  const { moduleId } = useParams();
  const navigate = useNavigate();
  const lessons = useQuery({
    queryKey: ["lessons", moduleId],
    queryFn: () => apiFetch<LessonListItem[]>(`/app/modules/${moduleId}/lessons`),
  });

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
        <h1 className="text-lg font-bold text-ink">{t("lessons")}</h1>
      </div>
      <div className="flex flex-col gap-2">
        {lessons.data?.length === 0 && <p className="text-sm text-muted">{t("noLessonsYet")}</p>}
        {lessons.data?.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => navigate(`/lessons/${l.id}`)}
            className="border border-line flex items-center gap-3 rounded-card bg-card p-4 text-left"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-inset text-muted">
              {l.lessonType === "live" ? <Radio size={16} /> : <Video size={16} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{l.title}</p>
              <p className="text-xs text-muted">{new Date(l.scheduledAt).toLocaleDateString("ru-RU")}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
