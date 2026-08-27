import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Minus, Pencil, TrendingUp, XCircle } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, ApiError } from "../lib/api";
import { useI18n, type StringKey } from "../lib/i18n";

type DiscBand = "good" | "ok" | "weak" | "broken";

type BankItem = {
  id: number;
  task_number: number;
  topic: string;
  source_ref: string | null;
  correct_option: string | null;
  is_closed: boolean;
  max_points: number;
  used_in_variants: number;
  responses: number;
  p_value: number | null;
  most_chosen: string | null;
  suspect_key: boolean;
  discrimination: number | null;
  discrimination_band: DiscBand | null;
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

      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-inset">
        {/* The useful band, a recessive zone under the fill. */}
        <div
          className="absolute inset-y-0 bg-line"
          style={{ left: `${GOOD_LOW * 100}%`, right: `${(1 - GOOD_HIGH) * 100}%` }}
        />
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${
            !confident ? "bg-muted/40" : outside ? "bg-warn" : "bg-brand"
          }`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
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

export function ItemBankPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [sort, setSort] = useState<"task" | "difficulty" | "discrimination">("task");

  const items = useQuery({
    queryKey: ["cert-items"],
    queryFn: () => apiFetch<BankItem[]>("/cert-items"),
  });

  const all = useMemo(() => items.data ?? [], [items.data]);

  const isProblem = (i: BankItem) =>
    i.suspect_key ||
    i.discrimination_band === "broken" ||
    i.discrimination_band === "weak" ||
    (i.p_value !== null &&
      i.responses >= MIN_RESPONSES_FOR_VERDICT &&
      (i.p_value > GOOD_HIGH || i.p_value < GOOD_LOW));

  const summary = useMemo(
    () => ({
      total: all.length,
      suspectKey: all.filter((i) => i.suspect_key || i.discrimination_band === "broken").length,
      weak: all.filter((i) => i.discrimination_band === "weak").length,
      noData: all.filter((i) => i.responses < MIN_RESPONSES_FOR_VERDICT).length,
    }),
    [all],
  );

  const shown = useMemo(() => {
    const list = onlyProblems ? all.filter(isProblem) : [...all];
    if (sort === "difficulty") {
      return list.sort((a, b) => (a.p_value ?? 2) - (b.p_value ?? 2));
    }
    if (sort === "discrimination") {
      return list.sort((a, b) => (a.discrimination ?? 99) - (b.discrimination ?? 99));
    }
    return list.sort((a, b) => a.task_number - b.task_number || a.id - b.id);
  }, [all, onlyProblems, sort]);

  return (
    <>
      <TopBar title={t("bankTitle")} />
      <main className="px-4 pb-10 sm:px-8">
        <p className="mb-5 text-sm text-muted">{t("bankSubtitle")}</p>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label={t("statTotal")} value={summary.total} />
          <StatTile label={t("statNeedKey")} value={summary.suspectKey} tone="text-neg" />
          <StatTile label={t("statNoDiscriminate")} value={summary.weak} tone="text-warn" />
          <StatTile label={t("statNoData")} value={summary.noData} tone="text-muted" />
        </div>

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
        {all.length === 0 && !items.isLoading && (
          <p className="text-sm text-muted">{t("bankEmpty")}</p>
        )}

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
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/bank/${item.id}`)}
                    title={t("cardTitle")}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-inset text-sm font-semibold tabular-nums text-muted hover:bg-brand hover:text-on-brand"
                  >
                    {item.task_number}
                  </button>

                  <div className="min-w-0 flex-1 basis-48">
                    <button
                      type="button"
                      onClick={() => navigate(`/bank/${item.id}`)}
                      className="block max-w-full truncate text-left text-sm font-medium text-ink hover:underline"
                    >
                      {t(TOPIC_KEYS[item.topic] ?? "bankTopic")}
                    </button>
                    <SourceEditor item={item} />
                  </div>

                  {item.is_closed && (
                    <div className="shrink-0 text-center">
                      <p className="text-[11px] text-muted">{t("bankKey")}</p>
                      <p className="text-sm font-semibold text-ink">{item.correct_option}</p>
                    </div>
                  )}

                  <div className="w-28 shrink-0">
                    <p className="mb-0.5 text-[11px] text-muted">{t("diffTitle")}</p>
                    <DifficultyMeter value={item.p_value} confident={confident} />
                  </div>

                  <div className="shrink-0">
                    <p className="mb-1 text-[11px] text-muted">{t("discTitle")}</p>
                    <DiscriminationChip item={item} />
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-muted">{t("bankResponses")}</p>
                    <p
                      className={`text-sm font-semibold tabular-nums ${
                        confident ? "text-ink" : "text-muted"
                      }`}
                    >
                      {item.responses}
                    </p>
                    {!confident && <p className="text-[10px] text-muted">{t("lowConfidence")}</p>}
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-muted">{t("bankUsedIn")}</p>
                    <p className="text-sm font-semibold tabular-nums text-ink">
                      {item.used_in_variants}
                    </p>
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
