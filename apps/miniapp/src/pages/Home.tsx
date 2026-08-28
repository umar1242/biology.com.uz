import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { apiFetch } from "../lib/api";
import type { HomeworkListItem, Profile } from "../lib/types";
import { homeworkStatusLabel } from "../lib/statusLabels";
import { useSelectedCourse } from "../lib/selectedCourse";
import { useI18n } from "../lib/i18n";

export function HomePage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<Profile>("/app/profile") });
  const homework = useQuery({
    queryKey: ["homework"],
    queryFn: () => apiFetch<HomeworkListItem[]>("/app/homework"),
  });

  const { courses: switcherCourses, selectedCourse, selectedCourseId, setSelectedCourseId } = useSelectedCourse();
  const [courseMenuOpen, setCourseMenuOpen] = useState(false);

  const courses = profile.data?.courses ?? [];
  const activeCourses = courses.filter((c) => c.access_status === "active").length;
  // Everything below the switcher is scoped to the active course, so one
  // course's assignments never show up while another is selected.
  const allItems = homework.data ?? [];
  const items = selectedCourseId ? allItems.filter((h) => h.course_id === selectedCourseId) : allItems;
  const toDo = items.filter((h) => h.status === "not_submitted" || h.status === "needs_resubmission").length;
  const onReview = items.filter((h) => h.status === "pending").length;

  return (
    <div className="px-4 pt-5">
      <AppHeader name={profile.data?.first_name} />

      {switcherCourses.length > 0 && (
        <div className="relative z-30 mb-4">
          <button
            type="button"
            onClick={() => switcherCourses.length > 1 && setCourseMenuOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-card px-4 py-2.5 text-left"
          >
            <span className="min-w-0 truncate text-[15px] font-semibold text-ink">
              {selectedCourse?.title ?? switcherCourses[0]?.title}
            </span>
            {switcherCourses.length > 1 && (
              <ChevronDown
                size={18}
                className={`shrink-0 text-muted transition-transform ${courseMenuOpen ? "rotate-180" : ""}`}
              />
            )}
          </button>
          {courseMenuOpen && (
            <>
              {/* Click-away layer — a tap anywhere else closes the menu. */}
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setCourseMenuOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-line bg-card shadow-lg">
                {switcherCourses.map((c) => {
                  const active = c.id === selectedCourseId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedCourseId(c.id);
                        setCourseMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 border-b border-line/60 px-4 py-3 text-left text-[14px] last:border-0 ${
                        active ? "font-semibold text-ink" : "text-muted"
                      }`}
                    >
                      <span className="min-w-0 truncate">{c.title}</span>
                      {active && <Check size={16} className="shrink-0 text-ink" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Hero — mirrors the reference's balance card: one headline figure, the
          breakdown under it, and the two primary actions on the same surface. */}
      <section className="mb-3 rounded-card border border-line bg-card p-5">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[13px] text-muted">{t("myCourses")}</p>
          <span className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted">
            {t("totalCount", { count: courses.length })}
          </span>
        </div>
        <p className="text-[32px] leading-tight font-bold text-ink">{activeCourses}</p>

        <dl className="mt-3 space-y-1.5 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-muted">{t("toSubmit")}</dt>
            <dd className="font-medium text-ink">{toDo}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{t("onReview")}</dt>
            <dd className="font-medium text-ink">{onReview}</dd>
          </div>
        </dl>

        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={() => navigate("/courses")}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line py-2.5 text-[13px] font-semibold text-ink"
          >
            {t("lessons")} <BookOpen size={14} />
          </button>
          <button
            type="button"
            onClick={() => navigate("/homework")}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand py-2.5 text-[13px] font-semibold text-on-brand"
          >
            {t("tabHomework")} <Plus size={14} />
          </button>
        </div>
      </section>

      {toDo > 0 && (
        <button
          type="button"
          onClick={() => navigate("/homework")}
          className="mb-5 flex w-full items-center justify-between rounded-card border border-line bg-card p-4 text-left"
        >
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">
              {toDo === 1 ? t("oneUnsubmitted") : t("manyUnsubmitted", { count: toDo })}
            </p>
            <p className="mt-0.5 text-xs text-muted">{t("openToSubmit")}</p>
          </div>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand">
            <ArrowUpRight size={15} />
          </span>
        </button>
      )}

      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-ink">{t("recentHomework")}</h2>
        <button
          type="button"
          onClick={() => navigate("/homework")}
          className="text-xs font-medium text-muted"
        >
          {t("all")}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {homework.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
        {!homework.isLoading && items.length === 0 && (
          <p className="rounded-card border border-line bg-card p-4 text-sm text-muted">
            {t("noHomeworkYet")}
          </p>
        )}
        {items.slice(0, 5).map((hw) => {
          const label = homeworkStatusLabel[hw.status];
          return (
            <button
              key={hw.id}
              type="button"
              onClick={() => navigate(`/homework/${hw.id}`)}
              className="flex items-center gap-3 rounded-card border border-line bg-card p-3.5 text-left"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-inset text-[13px] font-bold text-ink">
                {hw.course_title?.[0]?.toUpperCase() ?? "?"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-ink">
                  {hw.lesson_title}
                </span>
                <span className="block truncate text-xs text-muted">{hw.course_title}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${label.className}`}>
                  {t(label.key)}
                </span>
                <ChevronRight size={15} className="text-muted" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
