import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { apiFetch } from "../lib/api";
import type { Course } from "../lib/types";
import { useI18n } from "../lib/i18n";

export function CoursesPage() {
  const { t, formatDateTime, formatDate } = useI18n();
  const navigate = useNavigate();
  const courses = useQuery({ queryKey: ["app-courses"], queryFn: () => apiFetch<Course[]>("/app/courses") });

  return (
    <div className="px-5 pt-6">
      <h1 className="mb-5 text-xl font-bold text-ink">{t("myCourses")}</h1>
      <div className="flex flex-col gap-2">
        {courses.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
        {courses.data?.length === 0 && (
          <p className="text-sm text-muted">{t("noCoursesAvailable")}</p>
        )}
        {courses.data?.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => navigate(`/courses/${c.id}`)}
            className="border border-line flex items-center justify-between rounded-card bg-card p-4 text-left"
          >
            <div>
              <p className="text-sm font-semibold text-ink">{c.title}</p>
              <p className="text-xs text-muted">{c.subject === "biology" ? t("subjectBiology") : t("subjectChemistry")}</p>
            </div>
            <ChevronRight size={18} className="text-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}
