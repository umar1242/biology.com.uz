import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Trash2, UserPlus } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, ApiError } from "../lib/api";
import type { Assistant, AssistantPermission, Course } from "../lib/types";
import { useI18n, type StringKey } from "../lib/i18n";

const CAPABILITY_LABELS: {
  key: keyof Pick<AssistantPermission, "canReviewHomework" | "canManageAccess" | "canManageBlacklist">;
  labelKey: StringKey;
}[] = [
  { key: "canReviewHomework", labelKey: "capReview" },
  { key: "canManageAccess", labelKey: "capAccess" },
  { key: "canManageBlacklist", labelKey: "capBlacklist" },
];

function CoursePermissionRow({
  assistantId,
  course,
  existing,
}: {
  assistantId: number;
  course: Course;
  existing?: AssistantPermission;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [flags, setFlags] = useState({
    canReviewHomework: existing?.canReviewHomework ?? true,
    canManageAccess: existing?.canManageAccess ?? false,
    canManageBlacklist: existing?.canManageBlacklist ?? false,
  });

  // `existing` starts undefined (permissions query hasn't resolved yet on
  // first render) and only becomes the real row afterwards — useState's
  // initial value alone won't pick that up on a re-render, so sync it here.
  useEffect(() => {
    if (existing) {
      setFlags({
        canReviewHomework: existing.canReviewHomework,
        canManageAccess: existing.canManageAccess,
        canManageBlacklist: existing.canManageBlacklist,
      });
    }
  }, [existing]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["assistant-permissions", assistantId] });

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/assistants/${assistantId}/permissions/${course.id}`, {
        method: "PUT",
        body: JSON.stringify({
          can_review_homework: flags.canReviewHomework,
          can_manage_access: flags.canManageAccess,
          can_manage_blacklist: flags.canManageBlacklist,
        }),
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => apiFetch(`/assistants/${assistantId}/permissions/${course.id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-0">
      <p className="min-w-[140px] text-sm font-medium text-ink">{course.title}</p>
      <div className="flex flex-wrap items-center gap-4">
        {CAPABILITY_LABELS.map(({ key, labelKey }) => (
          <label key={key} className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={flags[key]}
              onChange={(e) => setFlags((f) => ({ ...f, [key]: e.target.checked }))}
              className="h-3.5 w-3.5 accent-neutral-950"
            />
            {t(labelKey)}
          </label>
        ))}
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand disabled:opacity-50"
        >
          {t("save")}
        </button>
        {existing && (
          <button
            type="button"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="flex items-center gap-1 rounded-lg bg-neg-soft px-2.5 py-1.5 text-xs font-semibold text-neg hover:bg-neg-soft disabled:opacity-50"
          >
            <Trash2 size={12} /> {t("remove")}
          </button>
        )}
      </div>
    </div>
  );
}

function AssistantCard({ assistant, courses }: { assistant: Assistant; courses: Course[] }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const permissions = useQuery({
    queryKey: ["assistant-permissions", assistant.staff_id],
    queryFn: () => apiFetch<AssistantPermission[]>(`/assistants/${assistant.staff_id}/permissions`),
    enabled: expanded,
  });

  return (
    <div className="border border-line rounded-2xl bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">{assistant.display_name}</p>
          <p className="text-xs text-muted">@{assistant.username}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              assistant.is_active ? "bg-pos-soft text-pos" : "bg-inset text-muted"
            }`}
          >
            {assistant.is_active ? t("accessActive") : t("disabled")}
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 rounded-full bg-inset px-3 py-1.5 text-xs font-medium text-ink hover:bg-inset"
          >
            {t("coursePermissions")} {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-line pt-3">
          {permissions.isLoading && <p className="text-xs text-muted">{t("loading")}</p>}
          {courses.length === 0 && <p className="text-xs text-muted">{t("createCourseFirst")}</p>}
          {courses.map((course) => (
            <CoursePermissionRow
              key={course.id}
              assistantId={assistant.staff_id}
              course={course}
              existing={permissions.data?.find((p) => p.courseId === course.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AssistantsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const assistants = useQuery({
    queryKey: ["assistants"],
    queryFn: () => apiFetch<Assistant[]>("/assistants"),
  });
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => apiFetch<Course[]>("/courses") });

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiFetch<Assistant>("/assistants", {
        method: "POST",
        body: JSON.stringify({ username, password, display_name: displayName }),
      }),
    onSuccess: () => {
      setUsername("");
      setPassword("");
      setDisplayName("");
      queryClient.invalidateQueries({ queryKey: ["assistants"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t("createAssistantFailed")),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username || !password || !displayName) return;
    create.mutate();
  }

  return (
    <>
      <TopBar title={t("assistants")} />
      <main className="px-4 pb-10 sm:px-8">
        <form
          onSubmit={handleSubmit}
          className="border border-line mb-6 flex flex-wrap items-end gap-3 rounded-2xl bg-card p-5"
        >
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("username")}</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("password")}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="flex-1 min-w-[160px] text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("displayName")}</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>
          <button
            type="submit"
            disabled={create.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
          >
            <UserPlus size={16} /> {t("add")}
          </button>
        </form>
        {error && <p className="mb-4 text-sm text-neg">{error}</p>}

        <div className="flex flex-col gap-3">
          {assistants.data?.length === 0 && (
            <p className="text-sm text-muted">{t("noAssistantsYet")}</p>
          )}
          {assistants.data?.map((a) => (
            <AssistantCard key={a.staff_id} assistant={a} courses={courses.data ?? []} />
          ))}
        </div>
      </main>
    </>
  );
}
