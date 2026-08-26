import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import type { HomeworkListItem } from "../lib/types";
import { homeworkStatusLabel } from "../lib/statusLabels";
import { useI18n } from "../lib/i18n";

export function HomeworkListPage() {
  const { t, formatDateTime, formatDate } = useI18n();
  const navigate = useNavigate();
  const homework = useQuery({
    queryKey: ["homework"],
    queryFn: () => apiFetch<HomeworkListItem[]>("/app/homework"),
  });

  return (
    <div className="px-5 pt-6">
      <h1 className="mb-5 text-xl font-bold text-ink">{t("homework")}</h1>
      <div className="flex flex-col gap-2">
        {homework.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
        {homework.data?.length === 0 && <p className="text-sm text-muted">{t("noHomeworkYet")}</p>}
        {homework.data?.map((hw) => {
          const label = homeworkStatusLabel[hw.status];
          return (
            <button
              key={hw.id}
              type="button"
              onClick={() => navigate(`/homework/${hw.id}`)}
              className="border border-line flex items-center justify-between rounded-card bg-card p-4 text-left"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{hw.lesson_title}</p>
                <p className="text-xs text-muted">
                  {hw.course_title} · {t("dueBy", { date: formatDate(hw.deadline_at) })}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${label.className}`}>
                {t(label.key)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
