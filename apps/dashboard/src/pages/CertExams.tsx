import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Anchor, CheckCircle2, ClipboardList, FileText, Plus, Send, Trash2 } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, ApiError } from "../lib/api";
import type { Course } from "../lib/types";
import { claimDeepLinkTab } from "../lib/telegramLink";
import { DeepLinkNotice } from "../components/DeepLinkNotice";
import { useI18n } from "../lib/i18n";

type AnchorCandidate = {
  id: number;
  task_number: number;
  correct_option: string;
  topic: string;
  source_ref: string | null;
  responses: number;
  p_value: number | null;
  already_in_this_exam: boolean;
};

type CertExam = {
  id: number;
  course_id: number;
  title: string;
  deadline_at: string;
  has_variant_file: boolean;
  variant_file_name: string | null;
  key_filled: number;
  key_required: number;
  published: boolean;
  total_max_points: number;
  anchor_count: number;
  anchor_recommended: number;
};

type KeyEntry = { task_number: number; correct_option: string; source_ref: string | null };

const OPTIONS_AD = ["A", "B", "C", "D"];
const OPTIONS_AF = ["A", "B", "C", "D", "E", "F"];

/** Mirrors apps/api/src/lib/certExam.ts — the spec's fixed 1–32 / 33–35 split. */
function optionsFor(task: number) {
  return task <= 32 ? OPTIONS_AD : OPTIONS_AF;
}

/**
 * 35 selects in a row would be a wall, so the key is laid out as a compact
 * grid the teacher can fill top-to-bottom while reading the printed variant.
 */
function AnswerKeyEditor({ exam }: { exam: CertExam }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<number, string>>({});
  // Optional per-task citation. Filling it in makes the same question in a
  // future variant resolve to the same bank item, so its statistics keep
  // accumulating instead of starting over.
  const [sources, setSources] = useState<Record<number, string>>({});
  const [showSources, setShowSources] = useState(false);
  const [showAnchors, setShowAnchors] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = useQuery({
    queryKey: ["cert-key", exam.id],
    queryFn: () => apiFetch<KeyEntry[]>(`/cert-exams/${exam.id}/answer-key`),
  });

  useEffect(() => {
    if (!key.data) return;
    setDraft(Object.fromEntries(key.data.map((k) => [k.task_number, k.correct_option])));
    setSources(
      Object.fromEntries(key.data.filter((k) => k.source_ref).map((k) => [k.task_number, k.source_ref!])),
    );
  }, [key.data]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/cert-exams/${exam.id}/answer-key`, {
        method: "PUT",
        body: JSON.stringify({
          answers: Object.entries(draft)
            .filter(([, v]) => v)
            .map(([n, v]) => ({
              task_number: Number(n),
              correct_option: v,
              ...(sources[Number(n)]?.trim() ? { source_ref: sources[Number(n)].trim() } : {}),
            })),
        }),
      }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["cert-exams"] });
      queryClient.invalidateQueries({ queryKey: ["cert-key", exam.id] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "error"),
  });

  const filled = Object.values(draft).filter(Boolean).length;

  const candidates = useQuery({
    queryKey: ["anchor-candidates", exam.id],
    queryFn: () => apiFetch<AnchorCandidate[]>(`/cert-exams/${exam.id}/anchor-candidates`),
    enabled: showAnchors,
  });

  /** Carrying an anchor over means copying BOTH its key and its citation —
      the citation is what makes it resolve to the same bank question. */
  function takeAnchor(c: AnchorCandidate) {
    if (!c.source_ref) return;
    setDraft((d) => ({ ...d, [c.task_number]: c.correct_option }));
    setSources((sv) => ({ ...sv, [c.task_number]: c.source_ref! }));
  }

  return (
    <div className="mt-4 rounded-2xl border border-line bg-inset p-4">
      <p className="text-sm font-semibold text-ink">{t("certKeyTitle")}</p>
      <p className="mt-1 mb-2 text-xs text-muted">{t("certKeyHint")}</p>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setShowSources((v) => !v)}
          className="text-xs font-medium text-brand"
        >
          {showSources ? "−" : "+"} {t("bankSource")}
        </button>
        <button
          type="button"
          onClick={() => setShowAnchors((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-brand"
        >
          <Anchor size={12} /> {t("anchorsPick")}
        </button>
      </div>

      {showAnchors && (
        <div className="mb-4 rounded-xl border border-line bg-card p-3">
          <p className="text-xs font-semibold text-ink">{t("anchorsTitle")}</p>
          <p className="mt-1 mb-2 text-xs text-muted">{t("anchorsHint")}</p>
          <p className="mb-3 text-xs text-muted">{t("anchorsSpread")}</p>

          {candidates.isLoading && <p className="text-xs text-muted">{t("loading")}</p>}
          {candidates.data?.length === 0 && (
            <p className="text-xs text-muted">{t("anchorsNone")}</p>
          )}

          <div className="flex flex-col gap-1.5">
            {candidates.data?.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-inset px-2.5 py-1.5"
              >
                <span className="w-6 text-xs font-semibold text-muted">{c.task_number}</span>
                <span className="min-w-0 flex-1 basis-32 truncate text-xs text-ink">
                  {c.source_ref ?? t("anchorsNeedSource")}
                </span>
                <span className="text-xs font-semibold text-ink">{c.correct_option}</span>
                <span className="text-xs text-muted">
                  {c.p_value === null ? t("bankNoData") : `${Math.round(c.p_value * 100)}%`}
                  {" · "}
                  {c.responses}
                </span>
                {c.already_in_this_exam ? (
                  <span className="text-xs font-medium text-pos">{t("anchorsTaken")}</span>
                ) : (
                  <button
                    type="button"
                    disabled={!c.source_ref}
                    onClick={() => takeAnchor(c)}
                    className="rounded-lg bg-brand px-2 py-1 text-xs font-semibold text-on-brand disabled:opacity-40"
                  >
                    {t("anchorsUse")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
        {Array.from({ length: 35 }, (_, i) => i + 1).map((n) => (
          <label
            key={n}
            className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 ${
              n >= 33 ? "border-brand/40" : "border-line"
            } bg-card`}
          >
            <span className="w-6 shrink-0 text-xs font-semibold text-muted">{n}</span>
            <select
              value={draft[n] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [n]: e.target.value }))}
              className="w-full bg-transparent text-sm font-medium text-ink outline-none"
            >
              <option value="">—</option>
              {optionsFor(n).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {showSources && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-muted">{t("bankSourceHint")}</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
            {Array.from({ length: 35 }, (_, i) => i + 1).map((n) => (
              <label key={n} className="flex items-center gap-2 rounded-xl border border-line bg-card px-2 py-1.5">
                <span className="w-6 shrink-0 text-xs font-semibold text-muted">{n}</span>
                <input
                  value={sources[n] ?? ""}
                  onChange={(e) => setSources((sv) => ({ ...sv, [n]: e.target.value }))}
                  className="w-full bg-transparent text-xs text-ink outline-none"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setError(null);
            save.mutate();
          }}
          disabled={save.isPending || filled === 0}
          className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
        >
          {t("certKeySave")}
        </button>
        <span className="text-xs text-muted">
          {t("certKeyProgress", { filled, required: 35 })}
        </span>
        {saved && <span className="text-xs font-medium text-pos">{t("certKeySaved")}</span>}
        {error && <span className="text-xs text-neg">{error}</span>}
      </div>
    </div>
  );
}

function ExamCard({ exam }: { exam: CertExam }) {
  const { t, formatDateTime } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["cert-exams"] });

  const attach = useMutation({
    mutationFn: () =>
      apiFetch<{ deep_link: string }>(`/cert-exams/${exam.id}/variant-file/attach-start`, {
        method: "POST",
      }),
  });

  const publish = useMutation({
    mutationFn: () =>
      apiFetch(`/cert-exams/${exam.id}/${exam.published ? "unpublish" : "publish"}`, {
        method: "POST",
      }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : "error"),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch(`/cert-exams/${exam.id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : "error"),
  });

  function startAttach() {
    setError(null);
    const tab = claimDeepLinkTab();
    attach.mutate(undefined, {
      onSuccess: (res) => {
        setDeepLink(res.deep_link);
        tab.navigate(res.deep_link);
      },
      onError: () => tab.cancel(),
    });
  }

  const ready = exam.has_variant_file && exam.key_filled >= exam.key_required;

  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{exam.title}</p>
          <p className="mt-0.5 text-xs text-muted">
            {t("certDeadline")}: {formatDateTime(exam.deadline_at)} · {exam.total_max_points}{" "}
            {t("certTotal").toLowerCase()}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            exam.published ? "bg-pos-soft text-pos" : "bg-inset text-muted"
          }`}
        >
          {exam.published ? t("certPublished") : t("certDraft")}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
            exam.has_variant_file ? "bg-pos-soft text-pos" : "bg-warn-soft text-warn"
          }`}
        >
          <FileText size={12} />
          {exam.has_variant_file ? t("certFileAttached") : t("certFileMissing")}
        </span>
        <span
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
            exam.key_filled >= exam.key_required ? "bg-pos-soft text-pos" : "bg-warn-soft text-warn"
          }`}
        >
          <CheckCircle2 size={12} />
          {t("certKeyProgress", { filled: exam.key_filled, required: exam.key_required })}
        </span>
        <span
          title={t("anchorsHint")}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
            exam.anchor_count >= exam.anchor_recommended
              ? "bg-pos-soft text-pos"
              : "bg-inset text-muted"
          }`}
        >
          <Anchor size={12} />
          {t("anchorsLabel", { n: exam.anchor_count, need: exam.anchor_recommended })}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={startAttach}
          disabled={attach.isPending}
          className="flex items-center gap-1.5 rounded-xl bg-inset px-3 py-2 text-xs font-semibold text-ink disabled:opacity-50"
        >
          <Send size={13} /> {t("certAttachFile")}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 rounded-xl bg-inset px-3 py-2 text-xs font-semibold text-ink"
        >
          <ClipboardList size={13} /> {t("certKeyTitle")}
        </button>
        <button
          type="button"
          onClick={() => navigate(`/cert/${exam.id}`)}
          className="flex items-center gap-1.5 rounded-xl bg-inset px-3 py-2 text-xs font-semibold text-ink"
        >
          {t("certAttempts")}
        </button>
        <button
          type="button"
          onClick={() => {
            // Advisory, not a gate: an all-new variant is a legitimate
            // choice, it just cannot be put on the same scale as the others.
            if (
              !exam.published &&
              exam.anchor_count < exam.anchor_recommended &&
              !window.confirm(
                t("anchorsWarnPublish", {
                  n: exam.anchor_count,
                  need: exam.anchor_recommended,
                }),
              )
            ) {
              return;
            }
            publish.mutate();
          }}
          disabled={publish.isPending || (!ready && !exam.published)}
          title={!ready && !exam.published ? t("certPublishBlocked") : undefined}
          className="rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
        >
          {exam.published ? t("certUnpublish") : t("certPublish")}
        </button>
        <button
          type="button"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          className="flex items-center gap-1.5 rounded-xl bg-neg-soft px-3 py-2 text-xs font-semibold text-neg disabled:opacity-50"
        >
          <Trash2 size={13} /> {t("certDeleteVariant")}
        </button>
      </div>

      {!ready && !exam.published && (
        <p className="mt-2 text-xs text-muted">{t("certPublishBlocked")}</p>
      )}
      {deepLink && <DeepLinkNotice url={deepLink} hint={t("certAttachHint")} />}
      {error && <p className="mt-2 text-xs text-neg">{error}</p>}
      {expanded && <AnswerKeyEditor exam={exam} />}
    </div>
  );
}

export function CertExamsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [courseId, setCourseId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState<string | null>(null);

  const courses = useQuery({ queryKey: ["courses"], queryFn: () => apiFetch<Course[]>("/courses") });

  const activeCourse = useMemo(
    () => courseId ?? courses.data?.[0]?.id ?? null,
    [courseId, courses.data],
  );

  const exams = useQuery({
    queryKey: ["cert-exams", activeCourse],
    queryFn: () => apiFetch<CertExam[]>(`/courses/${activeCourse}/cert-exams`),
    enabled: activeCourse !== null,
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch(`/courses/${activeCourse}/cert-exams`, {
        method: "POST",
        body: JSON.stringify({ title, deadline_at: new Date(deadline).toISOString() }),
      }),
    onSuccess: () => {
      setTitle("");
      setDeadline("");
      queryClient.invalidateQueries({ queryKey: ["cert-exams", activeCourse] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "error"),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !deadline) return;
    create.mutate();
  }

  return (
    <>
      <TopBar title={t("certTitle")} />
      <main className="px-4 pb-10 sm:px-8">
        <p className="mb-5 text-sm text-muted">{t("certSubtitle")}</p>

        <form
          onSubmit={handleCreate}
          className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-card p-5"
        >
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("certPickCourse")}</span>
            <select
              value={activeCourse ?? ""}
              onChange={(e) => setCourseId(Number(e.target.value))}
              className="rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-ink"
            >
              {courses.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[180px] flex-1 text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("certVariantName")}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-line px-3 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("certDeadline")}</span>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="rounded-xl border border-line px-3 py-2.5 text-sm text-ink outline-none focus:border-ink"
            />
          </label>
          <button
            type="submit"
            disabled={create.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={16} /> {t("certCreate")}
          </button>
        </form>
        {error && <p className="mb-4 text-sm text-neg">{error}</p>}

        <div className="flex flex-col gap-3">
          {exams.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
          {exams.data?.length === 0 && <p className="text-sm text-muted">{t("certNoVariants")}</p>}
          {exams.data?.map((e) => (
            <ExamCard key={e.id} exam={e} />
          ))}
        </div>
      </main>
    </>
  );
}
