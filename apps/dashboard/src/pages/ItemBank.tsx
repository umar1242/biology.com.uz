import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Pencil } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, ApiError } from "../lib/api";
import { useI18n, type StringKey } from "../lib/i18n";

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

/**
 * A question counts as "too easy"/"too hard" only once enough people have
 * actually answered it — below that the share is noise, and a badge the
 * teacher learns to distrust is worse than no badge.
 */
const MIN_RESPONSES_FOR_VERDICT = 10;

function difficultyBadge(item: BankItem, t: (k: StringKey) => string) {
  if (item.p_value === null || item.responses < MIN_RESPONSES_FOR_VERDICT) return null;
  if (item.p_value >= 0.9) return { label: t("bankTooEasy"), tone: "bg-inset text-muted" };
  if (item.p_value <= 0.2) return { label: t("bankTooHard"), tone: "bg-warn-soft text-warn" };
  return null;
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
        className="flex items-center gap-1.5 text-xs text-muted hover:text-ink"
      >
        <Pencil size={11} />
        {item.source_ref ?? t("bankSource")}
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
        className="min-w-[200px] flex-1 rounded-lg border border-line px-2 py-1 text-xs outline-none focus:border-ink"
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

export function ItemBankPage() {
  const { t } = useI18n();
  const [onlyProblems, setOnlyProblems] = useState(false);

  const items = useQuery({
    queryKey: ["cert-items"],
    queryFn: () => apiFetch<BankItem[]>("/cert-items"),
  });

  const shown = useMemo(() => {
    const all = items.data ?? [];
    if (!onlyProblems) return all;
    return all.filter(
      (i) =>
        i.suspect_key ||
        (i.p_value !== null &&
          i.responses >= MIN_RESPONSES_FOR_VERDICT &&
          (i.p_value >= 0.9 || i.p_value <= 0.2)),
    );
  }, [items.data, onlyProblems]);

  return (
    <>
      <TopBar title={t("bankTitle")} />
      <main className="px-4 pb-10 sm:px-8">
        <p className="mb-4 text-sm text-muted">{t("bankSubtitle")}</p>

        <div className="mb-5 flex gap-2">
          {[
            { key: false, label: t("bankFilterAll") },
            { key: true, label: t("bankFilterProblem") },
          ].map((f) => (
            <button
              key={String(f.key)}
              type="button"
              onClick={() => setOnlyProblems(f.key)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                onlyProblems === f.key ? "bg-brand text-on-brand" : "bg-card text-muted hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {items.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
        {items.data?.length === 0 && <p className="text-sm text-muted">{t("bankEmpty")}</p>}

        <div className="flex flex-col gap-2">
          {shown.map((item) => {
            const badge = difficultyBadge(item, t);
            return (
              <div
                key={item.id}
                className={`rounded-2xl border bg-card p-4 ${
                  item.suspect_key ? "border-warn" : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-inset text-sm font-semibold text-muted">
                    {item.task_number}
                  </div>

                  <div className="min-w-0 flex-1 basis-44">
                    <p className="truncate text-sm font-medium text-ink">
                      {t(TOPIC_KEYS[item.topic] ?? "bankTopic")}
                    </p>
                    <SourceEditor item={item} />
                  </div>

                  {item.is_closed && (
                    <div className="shrink-0 text-center">
                      <p className="text-[11px] text-muted">{t("bankKey")}</p>
                      <p className="text-sm font-semibold text-ink">{item.correct_option}</p>
                    </div>
                  )}

                  <div className="shrink-0 text-center">
                    <p className="text-[11px] text-muted">{t("bankResponses")}</p>
                    <p className="text-sm font-semibold text-ink">{item.responses}</p>
                  </div>

                  <div className="shrink-0 text-center">
                    <p className="text-[11px] text-muted">{t("bankDifficulty")}</p>
                    <p className="text-sm font-semibold text-ink">
                      {item.p_value === null ? "—" : `${Math.round(item.p_value * 100)}%`}
                    </p>
                  </div>

                  <div className="shrink-0 text-center">
                    <p className="text-[11px] text-muted">{t("bankUsedIn")}</p>
                    <p className="text-sm font-semibold text-ink">{item.used_in_variants}</p>
                  </div>

                  {badge && (
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${badge.tone}`}>
                      {badge.label}
                    </span>
                  )}
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
