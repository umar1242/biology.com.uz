import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { apiFetch } from "../lib/api";
import type { LessonListItem } from "../lib/types";
import { useI18n } from "../lib/i18n";

export function LessonsPage() {
  const { t, formatDate } = useI18n();
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

      {lessons.data?.length === 0 && <p className="text-sm text-muted">{t("noLessonsYet")}</p>}

      {lessons.data && lessons.data.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line bg-card">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="w-8 py-2.5 pl-4 pr-1 font-medium">{t("lessonColNum")}</th>
                <th className="py-2.5 px-2 font-medium">{t("lessonColTitle")}</th>
                <th className="w-20 py-2.5 px-2 font-medium">{t("lessonColType")}</th>
                <th className="w-16 py-2.5 pl-2 pr-4 text-right font-medium">{t("lessonColDate")}</th>
              </tr>
            </thead>
            <tbody>
              {lessons.data.map((l, i) => (
                <tr
                  key={l.id}
                  onClick={() => navigate(`/lessons/${l.id}`)}
                  className="cursor-pointer border-b border-line/60 last:border-0 active:bg-inset"
                >
                  <td className="py-3 pl-4 pr-1 align-top text-muted tabular-nums">{i + 1}</td>
                  <td className="truncate py-3 px-2 font-medium text-ink">{l.title}</td>
                  <td className="py-3 px-2 align-top">
                    <span
                      className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${
                        l.lessonType === "live" ? "text-neg" : "text-muted"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          l.lessonType === "live" ? "bg-neg" : "bg-muted"
                        }`}
                      />
                      {l.lessonType === "live" ? t("lessonTypeLiveShort") : t("lessonTypeRecordedShort")}
                    </span>
                  </td>
                  <td className="py-3 pl-2 pr-4 text-right align-top text-muted whitespace-nowrap tabular-nums">
                    {formatDate(l.scheduledAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
