import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Plus } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, ApiError } from "../lib/api";
import type { Course } from "../lib/types";
import { useI18n } from "../lib/i18n";

export function CoursesPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => apiFetch<Course[]>("/courses") });

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<"biology" | "chemistry">("biology");
  const [error, setError] = useState<string | null>(null);

  const createCourse = useMutation({
    mutationFn: () =>
      apiFetch<Course>("/courses", { method: "POST", body: JSON.stringify({ title, subject }) }),
    onSuccess: () => {
      setTitle("");
      queryClient.invalidateQueries({ queryKey: ["courses"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t("createCourseFailed")),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return;
    createCourse.mutate();
  }

  return (
    <>
      <TopBar title={t("courses")} />
      <main className="px-4 pb-10 sm:px-8">
        <form
          onSubmit={handleCreate}
          className="border border-line mb-6 flex flex-wrap items-end gap-3 rounded-2xl bg-card p-5"
        >
          <label className="flex-1 min-w-[200px] text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("courseTitle")}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("subjectBiology")}
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("subject")}</span>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value as "biology" | "chemistry")}
              className="rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
            >
              <option value="biology">{t("subjectBiology")}</option>
              <option value="chemistry">{t("subjectChemistry")}</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={createCourse.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={16} /> {t("create")}
          </button>
        </form>
        {error && <p className="mb-4 text-sm text-neg">{error}</p>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {courses.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
          {courses.data?.length === 0 && (
            <p className="text-sm text-muted">{t("noCoursesCreateFirst")}</p>
          )}
          {courses.data?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate(`/courses/${c.id}`)}
              className="border border-line flex items-start justify-between rounded-2xl bg-card p-5 text-left "
            >
              <div>
                <p className="text-sm font-semibold text-ink">{c.title}</p>
                <p className="mt-1 text-xs text-muted">
                  {c.subject === "biology" ? t("subjectBiology") : t("subjectChemistry")}
                  {c.isArchived ? t("archivedSuffix") : ""}
                </p>
                {c.description && <p className="mt-3 text-sm text-muted">{c.description}</p>}
              </div>
              <ChevronRight size={18} className="mt-0.5 shrink-0 text-muted" />
            </button>
          ))}
        </div>
      </main>
    </>
  );
}
