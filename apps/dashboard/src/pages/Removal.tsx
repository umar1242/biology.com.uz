import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserMinus } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, ApiError } from "../lib/api";
import type { Course, RemovalQueueItem } from "../lib/types";
import { useI18n } from "../lib/i18n";

type RemovalResult = { student_id: number; removed: boolean; reason?: string };

/**
 * Students whose free trial ran out unpaid. Nothing on this screen happens on
 * its own: freezing is automatic (they keep seeing the course but cannot act),
 * while actually kicking them out of the Telegram group is a deliberate act
 * here — a student who asked for a few more days to pay should be able to
 * stay in the group meanwhile.
 */
export function RemovalPage() {
  const { t, formatDate } = useI18n();
  const queryClient = useQueryClient();
  const [courseId, setCourseId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RemovalResult[] | null>(null);

  const courses = useQuery({ queryKey: ["courses"], queryFn: () => apiFetch<Course[]>("/courses") });
  useEffect(() => {
    if (courseId === null && courses.data?.[0]) setCourseId(courses.data[0].id);
  }, [courses.data, courseId]);

  const queue = useQuery({
    queryKey: ["removal-queue", courseId],
    queryFn: () => apiFetch<RemovalQueueItem[]>(`/courses/${courseId}/removal-queue`),
    enabled: courseId !== null,
  });

  // A stale selection would silently target the wrong people after switching
  // courses, so it is dropped whenever the list underneath changes.
  useEffect(() => {
    setSelected(new Set());
    setResults(null);
  }, [courseId]);

  const items = queue.data ?? [];
  const allSelected = items.length > 0 && selected.size === items.length;

  const remove = useMutation({
    mutationFn: () =>
      apiFetch<{ results: RemovalResult[] }>(`/courses/${courseId}/removal-queue/remove`, {
        method: "POST",
        body: JSON.stringify({ student_ids: [...selected] }),
      }),
    onSuccess: (res) => {
      setResults(res.results);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["removal-queue", courseId] });
      queryClient.invalidateQueries({ queryKey: ["roster", courseId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t("removalFailedRow")),
  });

  function toggle(studentId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  function handleRemove() {
    setError(null);
    if (selected.size === 0) return;
    if (!window.confirm(t("removalConfirm"))) return;
    remove.mutate();
  }

  return (
    <>
      <TopBar title={t("removalTitle")} />
      <main className="px-4 pb-10 sm:px-8">
        <p className="mb-5 max-w-2xl text-sm text-muted">{t("removalIntro")}</p>

        <div className="mb-5">
          <select
            value={courseId ?? ""}
            onChange={(e) => setCourseId(Number(e.target.value))}
            className="rounded-xl border border-line bg-card px-4 py-2.5 text-sm outline-none focus:border-ink"
          >
            {courses.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mb-4 text-sm text-neg">{error}</p>}

        {results && (
          <p className="mb-4 rounded-xl border border-line bg-card p-3.5 text-sm text-ink">
            {t("removalDone", {
              ok: results.filter((r) => r.removed).length,
              total: results.length,
            })}
          </p>
        )}

        {queue.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
        {!queue.isLoading && items.length === 0 && (
          <p className="text-sm text-muted">{t("removalEmpty")}</p>
        )}

        {items.length > 0 && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.student_id)))}
                className="text-xs font-medium text-muted hover:text-ink"
              >
                {allSelected ? t("removalClearAll") : t("removalSelectAll")}
              </button>
              <span className="text-xs text-muted">{t("removalSelected", { count: selected.size })}</span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-line bg-card">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="w-10 py-3 pl-4 pr-2" />
                    <th className="py-3 px-2 font-medium">{t("applicationFullName")}</th>
                    <th className="py-3 px-2 font-medium">{t("applicationPhone")}</th>
                    <th className="py-3 px-2 font-medium">{t("applicationParentPhone")}</th>
                    <th className="py-3 pl-2 pr-4 font-medium">{t("removalFrozenAt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const failed = results?.find((r) => r.student_id === item.student_id && !r.removed);
                    return (
                      <tr key={item.student_id} className="border-b border-line/60 last:border-0">
                        <td className="py-3 pl-4 pr-2">
                          <input
                            type="checkbox"
                            checked={selected.has(item.student_id)}
                            onChange={() => toggle(item.student_id)}
                            className="h-4 w-4 accent-current"
                          />
                        </td>
                        <td className="py-3 px-2">
                          <p className="font-medium text-ink">{item.full_name ?? item.first_name}</p>
                          {item.telegram_username && (
                            <p className="text-xs text-muted">@{item.telegram_username}</p>
                          )}
                          {failed && <p className="text-xs text-neg">{t("removalFailedRow")}</p>}
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap text-muted">{item.phone ?? "—"}</td>
                        <td className="py-3 px-2 whitespace-nowrap text-muted">
                          {item.parent_phone_primary ?? "—"}
                        </td>
                        <td className="py-3 pl-2 pr-4 whitespace-nowrap text-muted">
                          {item.frozen_at ? formatDate(item.frozen_at) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={handleRemove}
              disabled={selected.size === 0 || remove.isPending}
              className="mt-4 flex items-center gap-1.5 rounded-xl bg-neg-soft px-4 py-2.5 text-sm font-semibold text-neg disabled:opacity-50"
            >
              <UserMinus size={15} /> {remove.isPending ? t("removalPending") : t("removalButton")}
            </button>
          </>
        )}
      </main>
    </>
  );
}
