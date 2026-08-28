import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import type { HomeworkListItem } from "../lib/types";
import { homeworkStatusLabel } from "../lib/statusLabels";
import { useSelectedCourse } from "../lib/selectedCourse";
import { useI18n } from "../lib/i18n";

export function HomeworkListPage() {
  const { t, formatDate } = useI18n();
  const navigate = useNavigate();
  const { selectedCourse, selectedCourseId } = useSelectedCourse();
  const homework = useQuery({
    queryKey: ["homework"],
    queryFn: () => apiFetch<HomeworkListItem[]>("/app/homework"),
  });

  // Scoped to the course chosen by the Home switcher — course X's assignments
  // never appear while course Y is active.
  const items = (homework.data ?? []).filter(
    (hw) => selectedCourseId == null || hw.course_id === selectedCourseId,
  );

  return (
    <div className="px-5 pt-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-ink">{t("homework")}</h1>
        {selectedCourse && <p className="text-xs text-muted">{selectedCourse.title}</p>}
      </div>
      <div className="flex flex-col gap-2">
        {homework.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
        {!homework.isLoading && items.length === 0 && (
          <p className="text-sm text-muted">{t("noHomeworkYet")}</p>
        )}
        {items.map((hw) => {
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
                  {t("dueBy", { date: formatDate(hw.deadline_at) })}
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
