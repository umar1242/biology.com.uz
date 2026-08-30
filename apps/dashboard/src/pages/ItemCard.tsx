import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { AlertTriangle, Archive, RotateCcw } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, ApiError } from "../lib/api";
import { useI18n, type StringKey } from "../lib/i18n";

type OptionRow = {
  option: string;
  is_key: boolean;
  count: number;
  share: number;
  strong_count: number;
  weak_count: number;
  dead: boolean;
};

type Usage = {
  exam_id: number;
  exam_title: string;
  deadline_at: string;
  responses: number;
  p_value: number | null;
};

type Card = {
  id: number;
  code: string;
  task_number: number;
  task_type: "Y1" | "Y2" | "O1" | "O2";
  topic: string;
  cognitive_level: 1 | 2 | null;
  source_ref: string | null;
  author: string | null;
  stem_text: string | null;
  notes: string | null;
  status: "active" | "retired";
  correct_option: string | null;
  options: string[];
  is_closed: boolean;
  max_points: number;
  grading_mode: "manual" | "typed";
  max_parts: number;
  answer_key: string[][];
  part_points: number[];
  entered_by: string | null;
  key_revised_at: string | null;
  stats: {
    responses: number;
    correct: number;
    blank: number;
    p_value: number | null;
    discrimination: number | null;
    discrimination_band: "good" | "ok" | "weak" | "broken" | null;
    min_responses_for_verdict: number;
    difficulty: number | null;
    difficulty_se: number | null;
    infit: number | null;
    outfit: number | null;
    fit_band: "overfit" | "productive" | "underfit" | "degrading" | null;
    calibration_state: "none" | "provisional" | "stable";
    calibration_responses: number;
    calibration_responses_needed: number;
    options: OptionRow[];
  };
  usage: Usage[];
  flags: string[];
};

const TOPIC_KEYS: Record<string, StringKey> = {
  life_science: "topicLifeScience",
  cell: "topicCell",
  systematics: "topicSystematics",
  plants_animals: "topicPlantsAnimals",
  human: "topicHuman",
  species_population: "topicSpeciesPopulation",
  ecosystem: "topicEcosystem",
  logic: "topicLogic",
  general_bio: "topicGeneralBio",
};

const TYPE_KEYS: Record<Card["task_type"], StringKey> = {
  Y1: "cardTypeY1",
  Y2: "cardTypeY2",
  O1: "cardTypeO1",
  O2: "cardTypeO2",
};

const FLAG_KEYS: Record<string, StringKey> = {
  suspect_key: "flagSuspectKey",
  negative_discrimination: "flagNegativeDisc",
  too_easy: "flagTooEasy",
  too_hard: "flagTooHard",
  dead_distractor: "flagDeadDistractor",
  key_revised_mid_flight: "flagKeyRevised",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-muted">{label}</p>
      <div className="mt-0.5 text-sm text-ink">{children}</div>
    </div>
  );
}

/**
 * Per-option bars use emphasis rather than a categorical palette: the key is
 * the one mark that carries meaning, so it gets the accent and every
 * distractor stays neutral. Colouring four options four hues would imply the
 * letters are categories worth telling apart, which they are not.
 */
function OptionBreakdown({ rows, total }: { rows: OptionRow[]; total: number }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.option} className="flex items-center gap-3">
          <span
            className={`w-6 shrink-0 text-sm font-semibold ${r.is_key ? "text-pos" : "text-muted"}`}
          >
            {r.option}
          </span>

          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-inset">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${
                r.is_key ? "bg-pos" : "bg-muted/50"
              }`}
              style={{ width: `${Math.round(r.share * 100)}%` }}
            />
          </div>

          <span className="w-11 shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
            {Math.round(r.share * 100)}%
          </span>

          <span className="w-24 shrink-0 text-right text-[11px] text-muted tabular-nums">
            {r.count} / {total}
          </span>

          <span className="w-40 shrink-0 text-right text-[11px] text-muted">
            {r.is_key && <span className="mr-2 font-medium text-pos">{t("cardOptionKey")}</span>}
            {r.dead && <span className="mr-2 font-medium text-warn">{t("cardOptionDead")}</span>}
            {(r.strong_count > 0 || r.weak_count > 0) && (
              <span className="tabular-nums">
                {t("cardOptionStrong")} {r.strong_count} · {t("cardOptionWeak")} {r.weak_count}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Режим проверки открытого задания и ключ к нему.
 *
 * Баллы по частям не вводятся, а показываются: они делятся поровну, и поле
 * для них означало бы число, которое можно рассинхронизировать с максимумом
 * задания.
 */
function AnswerKeyEditor({
  card,
  onSave,
  saving,
}: {
  card: Card;
  onSave: (body: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"manual" | "typed">(card.grading_mode);
  // Ключ редактируется строками: одна строка на часть, синонимы через «|».
  const [rows, setRows] = useState<string[]>(
    card.answer_key.length > 0 ? card.answer_key.map((v) => v.join(" | ")) : [""],
  );

  const parts = rows
    .map((r) => r.split("|").map((v) => v.trim()).filter(Boolean))
    .filter((v) => v.length > 0);
  const points = splitEvenly(card.max_points, parts.length);
  const canSave = mode === "manual" || parts.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5 rounded-xl bg-inset p-1.5">
        {(["manual", "typed"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-lg py-2 text-[13px] font-semibold transition-colors ${
              mode === m ? "bg-brand text-on-brand" : "text-muted"
            }`}
          >
            {m === "manual" ? t("gradingManual") : t("gradingTyped")}
          </button>
        ))}
      </div>

      {mode === "typed" && (
        <>
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              {card.max_parts > 1 && (
                <span className="w-10 shrink-0 text-xs text-muted tabular-nums">
                  {points[i] ?? 0} {t("gradingPts")}
                </span>
              )}
              <input
                value={row}
                onChange={(e) =>
                  setRows((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                }
                placeholder={t("gradingKeyPlaceholder")}
                className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm outline-none focus:border-ink"
              />
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted hover:text-neg"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {rows.length < card.max_parts && (
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, ""])}
              className="self-start rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-ink"
            >
              {t("gradingAddPart")}
            </button>
          )}
          <p className="text-xs text-muted">{t("gradingSynonymHint")}</p>
        </>
      )}

      <button
        type="button"
        disabled={saving || !canSave}
        onClick={() =>
          onSave(
            mode === "typed"
              ? { grading_mode: "typed", answer_key: parts }
              : { grading_mode: "manual" },
          )
        }
        className="self-start rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand disabled:opacity-50"
      >
        {t("save")}
      </button>
    </div>
  );
}

/** Те же баллы по частям, что считает сервер: поровну, остаток первым. */
function splitEvenly(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const rem = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0));
}

export function ItemCardPage() {
  const { id } = useParams();
  // The folder the card was opened from, so «назад» returns to that variant
  // rather than to the root of the bank.
  const location = useLocation();
  const backTo = (location.state as { from?: string } | null)?.from ?? "/bank";
  const { t, formatDateTime } = useI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ stem: "", author: "", notes: "", cognitive: "" });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const card = useQuery({
    queryKey: ["cert-item-card", id],
    queryFn: () => apiFetch<Card>(`/cert-items/${id}/card`),
  });

  useEffect(() => {
    if (!card.data) return;
    setDraft({
      stem: card.data.stem_text ?? "",
      author: card.data.author ?? "",
      notes: card.data.notes ?? "",
      cognitive: card.data.cognitive_level ? String(card.data.cognitive_level) : "",
    });
  }, [card.data]);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/cert-items/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["cert-item-card", id] });
      queryClient.invalidateQueries({ queryKey: ["cert-items"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "error"),
  });

  const c = card.data;

  return (
    <>
      <TopBar title={c ? `${t("cardTitle")} ${c.code}` : t("cardTitle")} backTo={backTo} />
      <main className="max-w-4xl px-4 pb-10 sm:px-8">
        {card.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}

        {c && (
          <div className="flex flex-col gap-4">
            {c.flags.length > 0 && (
              <div className="rounded-2xl border border-warn bg-warn-soft p-4">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-warn">
                  <AlertTriangle size={15} /> {t("cardFlags")}
                </p>
                <ul className="flex flex-col gap-1">
                  {c.flags.map((f) => (
                    <li key={f} className="text-xs text-warn">
                      • {t(FLAG_KEYS[f] ?? "cardFlags")}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Identity */}
            <div className="rounded-2xl border border-line bg-card p-5">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label={t("cardId")}>
                  <span className="font-semibold tabular-nums">{c.code}</span>
                </Field>
                <Field label={t("bankTask")}>
                  <span className="tabular-nums">{c.task_number}</span>
                </Field>
                <Field label={t("bankTopic")}>{t(TOPIC_KEYS[c.topic] ?? "bankTopic")}</Field>
                <Field label={t("bankKey")}>
                  <span className="font-semibold">{c.correct_option ?? "—"}</span>
                </Field>
                <Field label={t("cardType")}>{t(TYPE_KEYS[c.task_type])}</Field>
                <Field label={t("bankSource")}>{c.source_ref ?? "—"}</Field>
                <Field label={t("cardEnteredBy")}>{c.entered_by ?? "—"}</Field>
                <Field label={t("cardStatus")}>
                  {c.status === "active" ? t("cardActive") : t("cardRetired")}
                </Field>
              </div>
            </div>

            {/* Rasch placement — the only figure here comparable with items
                from other variants. Shown as its own block because it answers
                a different question than the counts above. */}
            <div className="rounded-2xl border border-line bg-card p-5">
              <p className="mb-3 text-sm font-semibold text-ink">{t("calibTitle")}</p>
              {c.stats.difficulty === null ? (
                <p className="text-sm text-muted">
                  {t("calibNoData", {
                    have: c.stats.calibration_responses,
                    need: c.stats.calibration_responses_needed,
                  })}
                </p>
              ) : (
                <>
                  <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <Field label={t("calibDifficulty")}>
                      <span className="text-xl font-semibold tabular-nums">
                        {c.stats.difficulty >= 0 ? "+" : ""}
                        {c.stats.difficulty.toFixed(2)}
                        {c.stats.difficulty_se !== null && (
                          <span className="ml-1.5 text-sm font-normal text-muted">
                            ± {c.stats.difficulty_se.toFixed(2)}
                          </span>
                        )}
                      </span>
                    </Field>
                    <Field label="Infit">
                      <span className="text-xl font-semibold tabular-nums">
                        {c.stats.infit?.toFixed(2) ?? "—"}
                      </span>
                    </Field>
                    <Field label="Outfit">
                      <span className="text-xl font-semibold tabular-nums">
                        {c.stats.outfit?.toFixed(2) ?? "—"}
                      </span>
                    </Field>
                  </div>
                  {c.stats.fit_band && (
                    <p
                      className={`text-sm ${
                        c.stats.fit_band === "degrading"
                          ? "text-neg"
                          : c.stats.fit_band === "underfit"
                            ? "text-warn"
                            : "text-muted"
                      }`}
                    >
                      {t(
                        c.stats.fit_band === "degrading"
                          ? "fitDegrading"
                          : c.stats.fit_band === "underfit"
                            ? "fitUnderfit"
                            : c.stats.fit_band === "overfit"
                              ? "fitOverfit"
                              : "fitProductive",
                      )}
                    </p>
                  )}
                  {c.stats.calibration_state === "provisional" && (
                    <p className="mt-2 text-xs text-muted">
                      {t("calibProvisional")} · {c.stats.calibration_responses}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Statistics */}
            <div className="rounded-2xl border border-line bg-card p-5">
              <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label={t("bankResponses")}>
                  <span className="text-xl font-semibold tabular-nums">{c.stats.responses}</span>
                </Field>
                <Field label={t("diffTitle")}>
                  <span className="text-xl font-semibold tabular-nums">
                    {c.stats.p_value === null ? "—" : `${Math.round(c.stats.p_value * 100)}%`}
                  </span>
                </Field>
                <Field label={t("discTitle")}>
                  <span className="text-xl font-semibold tabular-nums">
                    {c.stats.discrimination === null
                      ? "—"
                      : `${c.stats.discrimination >= 0 ? "+" : ""}${c.stats.discrimination.toFixed(2)}`}
                  </span>
                </Field>
                <Field label={t("cardBlank")}>
                  <span className="text-xl font-semibold tabular-nums">{c.stats.blank}</span>
                </Field>
              </div>

              {c.stats.responses === 0 ? (
                <p className="text-sm text-muted">{t("cardNoStats")}</p>
              ) : (
                c.is_closed && (
                  <>
                    <p className="mb-1 text-sm font-semibold text-ink">{t("cardOptions")}</p>
                    <p className="mb-3 text-xs text-muted">{t("cardOptionsHint")}</p>
                    <OptionBreakdown rows={c.stats.options} total={c.stats.responses} />
                  </>
                )
              )}
            </div>

            {/* Проверка открытого задания */}
            {!c.is_closed && (
              <div className="rounded-2xl border border-line bg-card p-5">
                <p className="mb-1 text-sm font-semibold text-ink">{t("gradingTitle")}</p>
                <p className="mb-3 text-xs text-muted">{t("gradingHint")}</p>
                <AnswerKeyEditor card={c} onSave={(body) => patch.mutate(body)} saving={patch.isPending} />
              </div>
            )}

            {/* Usage across variants */}
            <div className="rounded-2xl border border-line bg-card p-5">
              <p className="mb-3 text-sm font-semibold text-ink">{t("cardUsage")}</p>
              {c.usage.length === 0 && <p className="text-xs text-muted">{t("cardUsageEmpty")}</p>}
              <div className="flex flex-col gap-1.5">
                {c.usage.map((u) => (
                  <div
                    key={u.exam_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-inset px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm text-ink">{u.exam_title}</span>
                    <span className="text-xs text-muted tabular-nums">
                      {formatDateTime(u.deadline_at)} · {u.responses} ·{" "}
                      {u.p_value === null ? "—" : `${Math.round(u.p_value * 100)}%`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Editable content */}
            <div className="rounded-2xl border border-line bg-card p-5">
              <label className="mb-4 block text-sm">
                <span className="mb-1 block font-medium text-ink">{t("cardStem")}</span>
                <span className="mb-1.5 block text-xs text-muted">{t("cardStemHint")}</span>
                <textarea
                  value={draft.stem}
                  onChange={(e) => setDraft((d) => ({ ...d, stem: e.target.value }))}
                  rows={4}
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink"
                />
              </label>

              <div className="mb-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-ink">{t("cardAuthor")}</span>
                  <input
                    value={draft.author}
                    onChange={(e) => setDraft((d) => ({ ...d, author: e.target.value }))}
                    className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-ink">{t("cardCognitive")}</span>
                  <select
                    value={draft.cognitive}
                    onChange={(e) => setDraft((d) => ({ ...d, cognitive: e.target.value }))}
                    className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-ink"
                  >
                    <option value="">{t("cardCogUnset")}</option>
                    <option value="1">{t("cardCogI")}</option>
                    <option value="2">{t("cardCogII")}</option>
                  </select>
                </label>
              </div>

              <label className="mb-4 block text-sm">
                <span className="mb-1.5 block font-medium text-ink">{t("cardNotes")}</span>
                <textarea
                  value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                  rows={2}
                  className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink"
                />
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    patch.mutate({
                      stem_text: draft.stem.trim() || null,
                      author: draft.author.trim() || null,
                      notes: draft.notes.trim() || null,
                      cognitive_level: draft.cognitive ? Number(draft.cognitive) : null,
                    });
                  }}
                  disabled={patch.isPending}
                  className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
                >
                  {t("cardSave")}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    patch.mutate({ status: c.status === "active" ? "retired" : "active" })
                  }
                  disabled={patch.isPending}
                  className="flex items-center gap-1.5 rounded-xl bg-inset px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
                >
                  {c.status === "active" ? <Archive size={15} /> : <RotateCcw size={15} />}
                  {c.status === "active" ? t("cardRetire") : t("cardRestore")}
                </button>

                {saved && <span className="text-sm text-pos">{t("cardSaved")}</span>}
                {error && <span className="text-sm text-neg">{error}</span>}
              </div>
              <p className="mt-2 text-xs text-muted">{t("cardRetireHint")}</p>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
