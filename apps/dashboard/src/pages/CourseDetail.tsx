import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Link2, Plus } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, ApiError } from "../lib/api";
import type { Course, Module } from "../lib/types";
import { claimDeepLinkTab } from "../lib/telegramLink";
import { DeepLinkNotice } from "../components/DeepLinkNotice";
import { useI18n } from "../lib/i18n";

type TelegramGroup = { linked?: boolean; telegramChatId?: number; botIsMember?: boolean };

export function CourseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useI18n();

  const course = useQuery({ queryKey: ["course", id], queryFn: () => apiFetch<Course>(`/courses/${id}`) });
  const modules = useQuery({
    queryKey: ["modules", id],
    queryFn: () => apiFetch<Module[]>(`/courses/${id}/modules`),
  });
  const group = useQuery({
    queryKey: ["telegram-group", id],
    queryFn: () => apiFetch<TelegramGroup>(`/courses/${id}/telegram-group`),
  });
  const invite = useQuery({
    queryKey: ["invite-link", id],
    queryFn: () => apiFetch<{ invite_link: string }>(`/courses/${id}/invite-link`),
  });

  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);

  const createModule = useMutation({
    mutationFn: () => apiFetch<Module>(`/courses/${id}/modules`, { method: "POST", body: JSON.stringify({ title }) }),
    onSuccess: () => {
      setTitle("");
      queryClient.invalidateQueries({ queryKey: ["modules", id] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t("createModuleFailed")),
  });

  const linkGroup = useMutation({
    mutationFn: () => apiFetch<{ deep_link: string }>(`/courses/${id}/telegram-group/link-start`, { method: "POST" }),
    onError: (err) => setError(err instanceof ApiError ? err.message : t("linkStartFailed")),
  });

  function startGroupLink() {
    setError(null);
    const tab = claimDeepLinkTab();
    linkGroup.mutate(undefined, {
      onSuccess: (res) => {
        setDeepLink(res.deep_link);
        tab.navigate(res.deep_link);
      },
      onError: () => tab.cancel(),
    });
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return;
    createModule.mutate();
  }

  return (
    <>
      <TopBar title={course.data?.title ?? t("course")} backTo="/courses" />
      <main className="px-4 pb-10 sm:px-8">
        {/* First thing a teacher needs after creating a course: the link that
            lets students actually join it. */}
        <div className="mb-6 rounded-2xl border border-line bg-card p-5">
          <p className="mb-1 text-sm font-semibold text-ink">{t("studentInviteLink")}</p>
          <p className="mb-1 text-xs text-muted">
            {t("studentInviteHint")}
          </p>
          {invite.data && (
            <DeepLinkNotice
              url={invite.data.invite_link}
              hint={t("studentInviteNote")}
            />
          )}
        </div>

        <div className="border border-line mb-6 rounded-2xl bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">{t("courseGroup")}</p>
            {group.data?.linked !== false ? (
              <span className="rounded-full bg-pos-soft px-2.5 py-1 text-xs font-medium text-pos">
                {t("groupLinked")}
              </span>
            ) : (
              <span className="rounded-full bg-inset px-2.5 py-1 text-xs font-medium text-muted">
                {t("groupNotLinked")}
              </span>
            )}
          </div>
          {group.data?.linked === false && (
            <button
              type="button"
              onClick={startGroupLink}
              disabled={linkGroup.isPending}
              className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
            >
              <Link2 size={15} /> {t("linkGroup")}
            </button>
          )}
          {deepLink && (
            <DeepLinkNotice
              url={deepLink}
              hint={t("linkGroupHint")}
            />
          )}
        </div>

        <form
          onSubmit={handleCreate}
          className="border border-line mb-6 flex flex-wrap items-end gap-3 rounded-2xl bg-card p-5"
        >
          <label className="flex-1 min-w-[200px] text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("moduleTitle")}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder=""
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>
          <button
            type="submit"
            disabled={createModule.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={16} /> {t("addModule")}
          </button>
        </form>
        {error && <p className="mb-4 text-sm text-neg">{error}</p>}

        <div className="flex flex-col gap-2">
          {modules.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
          {modules.data?.length === 0 && (
            <p className="text-sm text-muted">{t("noModulesCreateFirst")}</p>
          )}
          {modules.data?.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => navigate(`/courses/${id}/modules/${m.id}`)}
              className="border border-line flex items-center justify-between rounded-2xl bg-card p-4 text-left "
            >
              <p className="text-sm font-medium text-ink">{m.title}</p>
              <ChevronRight size={18} className="text-muted" />
            </button>
          ))}
        </div>
      </main>
    </>
  );
}
