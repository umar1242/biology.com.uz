import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Layers,
  Minus,
  Pencil,
  RefreshCw,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, ApiError } from "../lib/api";
import { useI18n, type StringKey } from "../lib/i18n";

type DiscBand = "good" | "ok" | "weak" | "broken";

type BankItem = {
  id: number;
  /** «41-0041» — task number plus bank id. The item's name in the UI. */
  code: string;
  task_number: number;
  topic: string;
  source_ref: string | null;
  correct_option: string | null;
  is_closed: boolean;
  max_points: number;
  used_in_variants: number;
  exam_ids: number[];
  responses: number;
  p_value: number | null;
  most_chosen: string | null;
  suspect_key: boolean;
  discrimination: number | null;
  discrimination_band: DiscBand | null;
  difficulty: number | null;
  difficulty_se: number | null;
  infit: number | null;
  outfit: number | null;
  fit_band: "overfit" | "productive" | "underfit" | "degrading" | null;
  calibration_state: "none" | "provisional" | "stable";
  calibration_responses: number;
  calibration_responses_needed: number;
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

/** Below this many answers a percentage is noise dressed up as a measurement. */
const MIN_RESPONSES_FOR_VERDICT = 10;

/**
 * The band where a question actually sorts students. Outside it the item is
 * either free marks or unreachable — both waste one of the 40 scored slots.
 */
const GOOD_LOW = 0.3;
const GOOD_HIGH = 0.85;

/**
 * Difficulty as a meter rather than a bare number: the reader's real question
 * is "is this inside the useful band", which a position on a track answers at
 * a glance and a percentage does not. The band is drawn on the track itself,
 * so the judgement needs no lookup in a legend.
 */
function DifficultyMeter({ value, confident }: { value: number | null; confident: boolean }) {
  const { t } = useI18n();
  if (value === null) {
    return <span className="text-xs text-muted">{t("bankNoData")}</span>;
  }

  const pct = Math.round(value * 100);
  const outside = value < GOOD_LOW || value > GOOD_HIGH;

  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span
          className={`text-sm font-semibold tabular-nums ${
            outside && confident ? "text-warn" : "text-ink"
          }`}
        >
          {pct}%
        </span>
        {outside && confident && (
          <span className="text-[11px] text-warn">
            {value > GOOD_HIGH ? t("diffTooEasySoft") : t("diffTooHardSoft")}
          </span>
        )}
      </div>

      <div className="relative h-1.5 w-full rounded-full bg-inset">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${
            !confident ? "bg-muted/40" : outside ? "bg-warn" : "bg-brand"
          }`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
        {/* The band's edges as ticks rather than a filled zone: a fill at
            this size was indistinguishable from the track (measured 233 vs
            246 grey) and would compete with the value mark anyway. Ticks sit
            above the fill so they stay readable wherever the value lands. */}
        {[GOOD_LOW, GOOD_HIGH].map((edge) => (
          <div
            key={edge}
            className="absolute -top-0.5 -bottom-0.5 w-px bg-muted/70"
            style={{ left: `${edge * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Discrimination is a state, not a magnitude, so it gets the status
 * treatment: icon plus wording, with color only reinforcing — it has to stay
 * readable in grayscale and with any colour vision.
 */
function DiscriminationChip({ item }: { item: BankItem }) {
  const { t } = useI18n();

  if (item.discrimination === null || item.discrimination_band === null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-inset px-2.5 py-1 text-xs font-medium text-muted">
        <Minus size={12} /> {t("discNoData")}
      </span>
    );
  }

  const spec: Record<DiscBand, { tone: string; icon: typeof Check; label: StringKey }> = {
    good: { tone: "bg-pos-soft text-pos", icon: TrendingUp, label: "discGood" },
    ok: { tone: "bg-inset text-ink", icon: Check, label: "discOk" },
    weak: { tone: "bg-warn-soft text-warn", icon: AlertTriangle, label: "discWeak" },
    broken: { tone: "bg-neg-soft text-neg", icon: XCircle, label: "discBroken" },
  };
  const { tone, icon: Icon, label } = spec[item.discrimination_band];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      <Icon size={12} />
      {t(label)}
      <span className="tabular-nums opacity-70">
        {item.discrimination >= 0 ? "+" : ""}
        {item.discrimination.toFixed(2)}
      </span>
    </span>
  );
}

function SourceEditor({ item }: { item: BankItem }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.source_ref ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/cert-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ source_ref: value.trim() || null }),
      }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["cert-items"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "error"),
  });

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex max-w-full items-center gap-1.5 text-xs text-muted hover:text-ink"
      >
        <Pencil size={11} className="shrink-0" />
        <span className="truncate">{item.source_ref ?? t("bankSource")}</span>
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("bankSourceHint")}
        className="min-w-[180px] flex-1 rounded-lg border border-line px-2 py-1 text-xs outline-none focus:border-ink"
      />
      <button
        type="button"
        onClick={() => {
          setError(null);
          save.mutate();
        }}
        disabled={save.isPending}
        className="rounded-lg bg-brand px-2 py-1 text-xs font-semibold text-on-brand disabled:opacity-50"
      >
        <Check size={12} />
      </button>
      {error && <span className="text-xs text-neg">{error}</span>}
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? "text-ink"}`}>{value}</p>
    </div>
  );
}

type CalibrationRun = {
  run: {
    run_id: number | null;
    run_at: string | null;
    persons: number;
    items: number;
    converged: boolean;
    responses: number;
  } | null;
  min_responses: number;
};

/**
 * Calibration status and the button that recomputes it.
 *
 * Deliberately states how far off the threshold the bank is rather than just
 * hiding the numbers: a teacher who sees no difficulties anywhere should know
 * it is a shortage of answers, not a broken page.
 */
function CalibrationBar() {
  const { t, formatDateTime } = useI18n();
  const queryClient = useQueryClient();

  const latest = useQuery({
    queryKey: ["cert-calibration"],
    queryFn: () => apiFetch<CalibrationRun>("/cert-calibration/latest"),
  });

  const run = useMutation({
    mutationFn: () => apiFetch("/cert-calibration/run", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cert-calibration"] });
      queryClient.invalidateQueries({ queryKey: ["cert-items"] });
    },
  });

  const info = latest.data?.run ?? null;

  return (
    <div className="mb-6 rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{t("calibTitle")}</p>
          <p className="mt-0.5 text-xs text-muted">
            {info
              ? t("calibLastRun", {
                  date: formatDateTime(info.run_at ?? ""),
                  persons: info.persons,
                  items: info.items,
                })
              : t("calibNever")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-on-brand disabled:opacity-50"
        >
          <RefreshCw size={14} className={run.isPending ? "animate-spin" : ""} />
          {run.isPending ? t("calibRunning") : t("calibRun")}
        </button>
      </div>
      <p className="mt-2.5 text-xs leading-snug text-muted">
        {t("calibExplain", { min: latest.data?.min_responses ?? 30 })}
      </p>
    </div>
  );
}

type BankVariant = {
  id: number;
  title: string;
  course_id: number;
  course_title: string;
  published: boolean;
  deadline_at: string;
  created_at: string;
  item_count: number;
};

/** A question worth the teacher's attention: bad key, no discrimination, or
    a share correct outside the band where it sorts anyone. */
function isProblem(i: BankItem) {
  return (
    i.suspect_key ||
    i.discrimination_band === "broken" ||
    i.discrimination_band === "weak" ||
    (i.p_value !== null &&
      i.responses >= MIN_RESPONSES_FOR_VERDICT &&
      (i.p_value > GOOD_HIGH || i.p_value < GOOD_LOW))
  );
}

function useBankItems() {
  return useQuery({
    queryKey: ["cert-items"],
    queryFn: () => apiFetch<BankItem[]>("/cert-items"),
  });
}

/** One row of the folder view: a variant, or one of the two virtual folders. */
function BankFolder({
  title,
  subtitle,
  count,
  problems,
  chip,
  to,
}: {
  title: string;
  subtitle: string;
  count: number;
  problems: number;
  chip?: string;
  to: string;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="flex w-full items-center gap-4 rounded-2xl border border-line bg-card p-4 text-left transition-colors hover:border-brand"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-inset text-muted">
        <Layers size={18} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">{title}</span>
          {chip && (
            <span className="rounded-full bg-inset px-2 py-0.5 text-[11px] text-muted">{chip}</span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">{subtitle}</span>
      </span>

      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums text-ink">
          {t("bankItemsCount", { n: count })}
        </span>
        {problems > 0 && (
          <span className="block text-xs text-warn">{t("bankProblemsCount", { n: problems })}</span>
        )}
      </span>

      <ChevronRight size={16} className="shrink-0 text-muted" />
    </button>
  );
}

/**
 * The bank's front door: variants first, questions second.
 *
 * A flat bank sorted by task number interleaves every variant's «задание 5»,
 * and the teacher's own mental index is the variant they typed the key from —
 * so that is what the first screen offers. The two virtual folders below keep
 * the old flat view reachable and surface the items no variant uses.
 */
export function ItemBankPage() {
  const { t } = useI18n();
  const items = useBankItems();
  const variants = useQuery({
    queryKey: ["cert-item-variants"],
    queryFn: () => apiFetch<BankVariant[]>("/cert-items/variants"),
  });

  const all = useMemo(() => items.data ?? [], [items.data]);

  const summary = useMemo(
    () => ({
      total: all.length,
      suspectKey: all.filter((i) => i.suspect_key || i.discrimination_band === "broken").length,
      weak: all.filter((i) => i.discrimination_band === "weak").length,
      noData: all.filter((i) => i.responses < MIN_RESPONSES_FOR_VERDICT).length,
    }),
    [all],
  );

  // Per-variant counts are derived from the item list the page already
  // loads, so the folder view costs one extra request and no extra math
  // on the server.
  const byVariant = useMemo(() => {
    const map = new Map<number, { count: number; problems: number }>();
    for (const item of all) {
      const problem = isProblem(item);
      for (const examId of item.exam_ids) {
        const cur = map.get(examId) ?? { count: 0, problems: 0 };
        cur.count += 1;
        if (problem) cur.problems += 1;
        map.set(examId, cur);
      }
    }
    return map;
  }, [all]);

  const unused = useMemo(() => all.filter((i) => i.exam_ids.length === 0), [all]);

  return (
    <>
      <TopBar title={t("bankTitle")} />
      <main className="px-4 pb-10 sm:px-8">
        <p className="mb-5 text-sm text-muted">{t("bankVariantsSubtitle")}</p>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label={t("statTotal")} value={summary.total} />
          <StatTile label={t("statNeedKey")} value={summary.suspectKey} tone="text-neg" />
          <StatTile label={t("statNoDiscriminate")} value={summary.weak} tone="text-warn" />
          <StatTile label={t("statNoData")} value={summary.noData} tone="text-muted" />
        </div>

        <CalibrationBar />

        {(items.isLoading || variants.isLoading) && (
          <p className="text-sm text-muted">{t("loading")}</p>
        )}

        <div className="flex flex-col gap-2">
          {(variants.data ?? []).map((v) => {
            const stat = byVariant.get(v.id) ?? { count: v.item_count, problems: 0 };
            return (
              <BankFolder
                key={v.id}
                title={v.title}
                subtitle={v.course_title}
                chip={v.published ? t("certPublished") : t("certDraft")}
                count={stat.count}
                problems={stat.problems}
                to={`/bank/variant/${v.id}`}
              />
            );
          })}

          {variants.data?.length === 0 && !variants.isLoading && (
            <p className="text-sm text-muted">{t("bankNoVariants")}</p>
          )}

          {all.length > 0 && (
            <>
              <div className="mt-4" />
              <BankFolder
                title={t("bankAllItems")}
                subtitle={t("bankAllItemsHint")}
                count={all.length}
                problems={all.filter(isProblem).length}
                to="/bank/all"
              />
              {unused.length > 0 && (
                <BankFolder
                  title={t("bankUnusedItems")}
                  subtitle={t("bankUnusedHint")}
                  count={unused.length}
                  problems={unused.filter(isProblem).length}
                  to="/bank/unused"
                />
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}

/**
 * The questions themselves, for one variant or for the whole bank. Reached
 * only through the folder view above, so it always knows what it is showing
 * and can say so in the title bar.
 */
export function BankItemsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ examId?: string }>();
  const examId = params.examId ? Number(params.examId) : null;
  const scope: "variant" | "unused" | "all" =
    examId !== null ? "variant" : location.pathname.endsWith("/unused") ? "unused" : "all";

  const [onlyProblems, setOnlyProblems] = useState(false);
  const [sort, setSort] = useState<"task" | "difficulty" | "discrimination">("task");

  const items = useBankItems();
  const variants = useQuery({
    queryKey: ["cert-item-variants"],
    queryFn: () => apiFetch<BankVariant[]>("/cert-items/variants"),
    enabled: scope === "variant",
  });

  const variant = variants.data?.find((v) => v.id === examId) ?? null;

  const all = useMemo(() => {
    const list = items.data ?? [];
    if (scope === "variant") return list.filter((i) => i.exam_ids.includes(examId as number));
    if (scope === "unused") return list.filter((i) => i.exam_ids.length === 0);
    return list;
  }, [items.data, scope, examId]);

  const shown = useMemo(() => {
    const list = onlyProblems ? all.filter(isProblem) : [...all];
    if (sort === "difficulty") {
      // Rasch difficulty when the item has been placed; share correct
      // otherwise, so an uncalibrated bank still sorts sensibly.
      const anyCalibrated = list.some((i) => i.difficulty !== null);
      if (anyCalibrated) {
        return list.sort((a, b) => (b.difficulty ?? -99) - (a.difficulty ?? -99));
      }
      return list.sort((a, b) => (a.p_value ?? 2) - (b.p_value ?? 2));
    }
    if (sort === "discrimination") {
      return list.sort((a, b) => (a.discrimination ?? 99) - (b.discrimination ?? 99));
    }
    return list.sort((a, b) => a.task_number - b.task_number || a.id - b.id);
  }, [all, onlyProblems, sort]);

  const title =
    scope === "variant"
      ? (variant?.title ?? t("bankTitle"))
      : scope === "unused"
        ? t("bankUnusedItems")
        : t("bankAllItems");

  // Coming back from a card should land on the same folder, not the root.
  const openCard = (id: number) =>
    navigate(`/bank/item/${id}`, { state: { from: location.pathname } });

  const emptyText = scope === "variant" ? t("bankVariantEmpty") : t("bankEmpty");

  return (
    <>
      <TopBar title={title} backTo="/bank" />
      <main className="px-4 pb-10 sm:px-8">
        <p className="mb-5 text-sm text-muted">
          {scope === "variant" ? (variant?.course_title ?? t("bankSubtitle")) : t("bankSubtitle")}
        </p>

        {/* Both metrics are unfamiliar; without this the numbers are decoration. */}
        <div className="mb-6 rounded-2xl border border-line bg-inset p-4">
          <p className="mb-2 text-xs font-semibold text-ink">{t("scaleLegend")}</p>
          <p className="text-xs text-muted">
            <span className="font-medium text-ink">{t("diffTitle")}</span> — {t("diffExplain")}
          </p>
          <p className="mt-1 text-xs text-muted">
            <span className="font-medium text-ink">{t("discTitle")}</span> — {t("discExplain")}
          </p>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-2">
          {[
            { key: false, label: t("bankFilterAll") },
            { key: true, label: t("bankFilterProblem") },
          ].map((f) => (
            <button
              key={String(f.key)}
              type="button"
              onClick={() => setOnlyProblems(f.key)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                onlyProblems === f.key
                  ? "bg-brand text-on-brand"
                  : "bg-card text-muted hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}

          <span className="ml-auto text-xs text-muted">{t("sortBy")}</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-ink"
          >
            <option value="task">{t("sortByTask")}</option>
            <option value="difficulty">{t("sortByDifficulty")}</option>
            <option value="discrimination">{t("sortByDiscrimination")}</option>
          </select>
        </div>

        {items.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
        {all.length === 0 && !items.isLoading && <p className="text-sm text-muted">{emptyText}</p>}

        <div className="flex flex-col gap-2">
          {shown.map((item) => {
            const confident = item.responses >= MIN_RESPONSES_FOR_VERDICT;
            return (
              <div
                key={item.id}
                className={`rounded-2xl border bg-card p-4 ${
                  item.suspect_key || item.discrimination_band === "broken"
                    ? "border-neg"
                    : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                  <button
                    type="button"
                    onClick={() => openCard(item.id)}
                    title={t("cardTitle")}
                    className="mt-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-inset text-sm font-semibold tabular-nums text-muted hover:bg-brand hover:text-on-brand"
                  >
                    {item.task_number}
                  </button>

                  <div className="mt-4 min-w-0 flex-1 basis-48">
                    {/* The code, not the topic: nine topic names spread over
                        hundreds of questions name nothing in particular,
                        while the code addresses exactly this one. */}
                    <button
                      type="button"
                      onClick={() => openCard(item.id)}
                      className="block max-w-full truncate text-left text-sm font-semibold tabular-nums text-ink hover:underline"
                    >
                      {item.code}
                    </button>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs text-muted">
                        {t(TOPIC_KEYS[item.topic] ?? "bankTopic")}
                      </span>
                      <SourceEditor item={item} />
                    </div>
                  </div>

                  {/* Every metric column shares one grid: a 16px caption line
                      and a 32px value area. Centring columns of differing
                      height instead left the captions 4–6px out of line. */}
                  {item.is_closed && (
                    <div className="w-10 shrink-0 text-center">
                      <p className="h-4 text-[11px] leading-4 text-muted">{t("bankKey")}</p>
                      <div className="flex h-8 items-center justify-center">
                        <span className="text-sm font-semibold text-ink">
                          {item.correct_option}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="w-28 shrink-0">
                    <p className="h-4 text-[11px] leading-4 text-muted">{t("diffTitle")}</p>
                    <div className="flex h-8 flex-col justify-center">
                      <DifficultyMeter value={item.p_value} confident={confident} />
                    </div>
                  </div>

                  <div className="w-52 shrink-0">
                    <p className="h-4 text-[11px] leading-4 text-muted">{t("discTitle")}</p>
                    <div className="flex h-8 items-center">
                      <DiscriminationChip item={item} />
                    </div>
                  </div>

                  <div className="w-16 shrink-0 text-right">
                    <p className="h-4 text-[11px] leading-4 text-muted">{t("bankResponses")}</p>
                    <div className="flex h-8 flex-col justify-center">
                      <span
                        className={`text-sm font-semibold tabular-nums ${
                          confident ? "text-ink" : "text-muted"
                        }`}
                      >
                        {item.responses}
                      </span>
                      {!confident && (
                        <span className="text-[10px] leading-3 text-muted">
                          {t("lowConfidence")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="w-20 shrink-0 text-right">
                    <p className="h-4 text-[11px] leading-4 text-muted">{t("bankUsedIn")}</p>
                    <div className="flex h-8 items-center justify-end">
                      <span className="text-sm font-semibold tabular-nums text-ink">
                        {item.used_in_variants}
                      </span>
                    </div>
                  </div>
                </div>

                {item.suspect_key && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft p-3">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
                    <div>
                      <p className="text-xs font-semibold text-warn">{t("bankSuspectKey")}</p>
                      <p className="text-xs text-warn">
                        {t("bankSuspectHint", {
                          opt: item.most_chosen ?? "?",
                          key: item.correct_option ?? "?",
                        })}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}
