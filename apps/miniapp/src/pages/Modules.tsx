import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { apiFetch } from "../lib/api";
import type { Module } from "../lib/types";
import { useSelectedCourse } from "../lib/selectedCourse";
import { useI18n } from "../lib/i18n";

/**
 * Courses are not listed here at all — the course is chosen by the switcher on
 * the Home screen, so this section shows the modules of whichever course is
 * active, and drilling into one opens that module's lesson table.
 */
export function ModulesPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { selectedCourse, selectedCourseId, courses, isLoading } = useSelectedCourse();

  const modules = useQuery({
    queryKey: ["modules", selectedCourseId],
    queryFn: () => apiFetch<Module[]>(`/app/courses/${selectedCourseId}/modules`),
    enabled: selectedCourseId != null,
  });

  if (isLoading) {
    return <div className="px-5 pt-6 text-sm text-muted">{t("loading")}</div>;
  }
  if (courses.length === 0 || !selectedCourse) {
    return <div className="px-5 pt-6 text-sm text-muted">{t("noCoursesAvailable")}</div>;
  }

  return (
    <div className="px-5 pt-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-ink">{selectedCourse.title}</h1>
        <p className="text-xs text-muted">
          {selectedCourse.subject === "biology" ? t("subjectBiology") : t("subjectChemistry")} · {t("modules")}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {modules.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
        {modules.data?.length === 0 && <p className="text-sm text-muted">{t("noModulesYet")}</p>}
        {modules.data?.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => navigate(`/courses/${selectedCourseId}/modules/${m.id}`)}
            className="border border-line flex items-center justify-between rounded-card bg-card p-4 text-left"
          >
            <p className="text-sm font-medium text-ink">{m.title}</p>
            <ChevronRight size={18} className="text-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}
