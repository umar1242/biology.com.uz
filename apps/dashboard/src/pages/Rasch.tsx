import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Minus, RefreshCw } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n";

/** Столько якорей рекомендует сервер (RECOMMENDED_ANCHOR_COUNT). */
const RECOMMENDED_ANCHORS = 8;

type OverviewItem = {
  id: number;
  code: string;
  task_number: number;
  difficulty: number;
  standard_error: number;
  infit: number;
  outfit: number;
  fit_band: "overfit" | "productive" | "underfit" | "degrading";
  outfit_low: number | null;
  outfit_high: number | null;
  responses: number;
  state: "none" | "provisional" | "stable";
  solved_share: number | null;
};

type Overview = {
  run: {
    run_id: number;
    run_at: string;
    persons: number;
    items: number;
    converged: boolean;
  } | null;
  thresholds: { provisional: number; stable: number };
  map: {
    bin: number;
    rows: { from: number; persons: number; items: number }[];
    persons: number;
    items: number;
    person_mean: number | null;
    item_mean: number | null;
  };
  axis: { logit: number; share: number }[];
  bands: { from: number; persons: number; items: number; share: number }[];
  separation: { index: number; reliability: number; strata: number } | null;
  misfit: { underfit: OverviewItem[]; overfit: OverviewItem[] };
  links: {
    exam_id: number;
    title: string;
    items: number;
    calibrated: number;
    partners: { exam_id: number; title: string; shared: number; stable: number }[];
  }[];
  drift: {
    item_id: number;
    code: string;
    displacement: number;
    standard_error: number;
    z: number;
  }[];
  min_stable_anchors: number;
  score_tables: {
    exam_id: number;
    title: string;
    items: number;
    rows: { raw: number; logit: number }[];
  }[];
  disconnected: { exam_id: number; title: string; items: number }[];
  reference_exam_id: number | null;
  dimensionality: {
    exam_id: number;
    title: string;
    items: number;
    persons: number;
    first_contrast: number;
    noise_ceiling: number;
    suspect: boolean;
    top: { code: string; loading: number }[];
    bottom: { code: string; loading: number }[];
    dependent: { first: string; second: string; correlation: number; excess: number }[];
  }[];
  dimension_threshold: number;
  history: { run_id: number; run_at: string; persons: number; items: number }[];
};

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 rounded-2xl border border-line bg-card p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {hint && <p className="mt-1 mb-4 text-xs leading-snug text-muted">{hint}</p>}
      {!hint && <div className="mb-4" />}
      {children}
    </section>
  );
}

/**
 * Карта Райта в книжном виде: горизонтальная ось логитов, ученики
 * гистограммой вверх, задания — вниз от той же оси.
 *
 * Так её печатают в работах по раш-измерению, и не из привычки: обе величины
 * живут на ОДНОЙ шкале, и общая ось — единственный способ это показать. Смысл
 * карты в том, что стоит друг против друга по вертикали; развернув её боком,
 * мы это соседство теряли.
 *
 * Половины масштабируются независимо, и пик каждой подписан числом: учеников
 * и заданий может быть на порядок разное количество, и общий масштаб просто
 * расплющил бы меньшую половину в полоску.
 */
function WrightMap({ map, axis }: { map: Overview["map"]; axis: Overview["axis"] }) {
  const { t } = useI18n();
  const rows = useMemo(() => [...map.rows].sort((a, b) => a.from - b.from), [map.rows]);
  const shareAt = useMemo(() => new Map(axis.map((a) => [a.logit, a.share])), [axis]);

  const maxPersons = Math.max(1, ...rows.map((r) => r.persons));
  const maxItems = Math.max(1, ...rows.map((r) => r.items));

  const from = rows.length ? rows[0].from : 0;
  const to = rows.length ? rows[rows.length - 1].from + map.bin : 1;
  const span = to - from || 1;
  const positionOf = (logit: number) => ((logit - from) / span) * 100;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11px] text-muted">
        <span>
          {t("raschMapPersons")} · {map.persons}
          {map.person_mean !== null &&
            ` · ${t("raschMeanLine", { value: map.person_mean.toFixed(2) })}`}
        </span>
        <span>{t("raschPeak", { n: maxPersons })}</span>
      </div>

      <div className="relative">
        {/* Средние — вертикальные метки поверх обеих половин: расстояние между
            ними и есть попадание банка в тех, кто по нему учится. */}
        {map.person_mean !== null && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-accent/50"
            style={{ left: `${positionOf(map.person_mean)}%` }}
          />
        )}
        {map.item_mean !== null && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-ink/40"
            style={{ left: `${positionOf(map.item_mean)}%` }}
          />
        )}

        <div className="flex items-stretch gap-px">
          {rows.map((r) => {
            const whole = Math.abs(r.from - Math.round(r.from)) < 1e-9;
            return (
              <div key={r.from} className="relative flex flex-1 flex-col">
                <div className="flex h-24 items-end" title={`${r.persons}`}>
                  <div
                    className="w-full rounded-t-sm bg-accent"
                    style={{ height: `${(r.persons / maxPersons) * 100}%` }}
                  />
                </div>

                <div className={`h-px ${whole ? "bg-muted" : "bg-line"}`} />

                <div className="flex h-24 items-start" title={`${r.items}`}>
                  <div
                    className="w-full rounded-b-sm bg-ink"
                    style={{ height: `${(r.items / maxItems) * 100}%` }}
                  />
                </div>

                {/* Подпись шире колонки, поэтому центрируется поверх соседей:
                    целые логиты идут через четыре столбца, налезать не на что. */}
                {whole && (
                  <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-center whitespace-nowrap">
                    <div className="text-[11px] font-semibold tabular-nums text-ink">
                      {r.from > 0 ? "+" : ""}
                      {r.from.toFixed(0)}
                    </div>
                    <div className="text-[10px] tabular-nums text-muted">
                      {Math.round((shareAt.get(Math.round(r.from)) ?? 0) * 100)}%
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-9 flex items-baseline justify-between text-[11px] text-muted">
        <span>
          {t("raschMapItems")} · {map.items}
          {map.item_mean !== null &&
            ` · ${t("raschMeanLine", { value: map.item_mean.toFixed(2) })}`}
        </span>
        <span>{t("raschPeak", { n: maxItems })}</span>
      </div>
    </div>
  );
}

function MisfitList({ items, empty }: { items: OverviewItem[]; empty: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  if (items.length === 0) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          onClick={() => navigate(`/bank/item/${i.id}`)}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-inset px-3 py-2 text-left hover:bg-warn-soft"
        >
          <span className="text-sm font-semibold tabular-nums text-ink">{i.code}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted">
            <span>b {i.difficulty.toFixed(2)}</span>
            {i.solved_share !== null && (
              <span>{t("raschSolvedShare", { n: Math.round(i.solved_share * 100) })}</span>
            )}
            <span>infit {i.infit.toFixed(2)}</span>
            <span className="font-semibold text-ink">outfit {i.outfit.toFixed(2)}</span>
            {i.outfit_low !== null && i.outfit_high !== null && (
              <span>
                {t("fitEnvelope", {
                  low: i.outfit_low.toFixed(2),
                  high: i.outfit_high.toFixed(2),
                })}
              </span>
            )}
            <span>{i.responses}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function RaschPage() {
  const { t, formatDateTime } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tableExam, setTableExam] = useState<number | null>(null);

  const overview = useQuery({
    queryKey: ["cert-calibration-overview"],
    queryFn: () => apiFetch<Overview>("/cert-calibration/overview"),
  });

  // Эталон задаётся руками: от него зависит второе число в оценке каждого
  // ученика, и меняться само собой при добавлении варианта оно не должно.
  const setReference = useMutation({
    mutationFn: (examId: number) =>
      apiFetch("/cert-calibration/reference", {
        method: "PATCH",
        body: JSON.stringify({ exam_id: examId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cert-calibration-overview"] });
      queryClient.invalidateQueries({ queryKey: ["cert-attempts"] });
    },
  });

  const run = useMutation({
    mutationFn: () => apiFetch("/cert-calibration/run", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cert-calibration-overview"] });
      queryClient.invalidateQueries({ queryKey: ["cert-calibration"] });
      queryClient.invalidateQueries({ queryKey: ["cert-items"] });
    },
  });

  const data = overview.data;
  const table =
    data?.score_tables.find((s) => s.exam_id === tableExam) ?? data?.score_tables[0] ?? null;

  return (
    <>
      <TopBar title={t("raschTitle")} />
      <main className="px-4 pb-10 sm:px-8">
        <p className="mb-5 text-sm text-muted">{t("raschSubtitle")}</p>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{t("calibTitle")}</p>
            <p className="mt-0.5 text-xs text-muted">
              {data?.run
                ? t("calibLastRun", {
                    date: formatDateTime(data.run.run_at),
                    persons: data.run.persons,
                    items: data.run.items,
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

        {overview.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}

        {/* Прогон мог быть, но ни одно задание не набрало порога ответов —
            для страницы это то же самое, что калибровки не было вовсе. */}
        {data && data.map.items === 0 && (
          <p className="rounded-2xl border border-line bg-card p-5 text-sm text-muted">
            {t("raschEmpty", { min: data.thresholds.provisional })}
          </p>
        )}

        {/* Несвязность — не диагностика качества, а сообщение о том, что часть
            банка вообще не измерена. Поэтому выше всех блоков и красным. */}
        {data && data.disconnected.length > 0 && (
          <section className="mb-4 rounded-2xl border border-neg bg-card p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-neg">
              <AlertTriangle size={15} /> {t("raschDisconnectedTitle")}
            </p>
            <div className="mt-2.5 flex flex-col gap-1.5">
              {data.disconnected.map((d) => (
                <div
                  key={d.exam_id}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-neg-soft px-3 py-2"
                >
                  <span className="text-sm font-medium text-ink">{d.title}</span>
                  <span className="text-xs tabular-nums text-neg">
                    {t("raschDisconnectedItems", { n: d.items })}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-snug text-muted">{t("raschDisconnectedHint")}</p>
          </section>
        )}

        {data?.run && data.map.items > 0 && (
          <>
            {data.separation && (
              <Card title={t("raschSeparationTitle")} hint={t("raschSeparationHint")}>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: t("raschStrata"), value: data.separation.strata.toFixed(1) },
                    {
                      label: t("raschReliability"),
                      value: data.separation.reliability.toFixed(2),
                    },
                    { label: t("raschIndex"), value: data.separation.index.toFixed(2) },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl bg-inset p-3">
                      <p className="text-[11px] text-muted">{s.label}</p>
                      <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink">
                        {s.value}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card title={t("raschMapTitle")} hint={t("raschMapHint")}>
              <WrightMap map={data.map} axis={data.axis} />
              <p className="mt-3 text-xs leading-snug text-muted">{t("raschAxisHint")}</p>
            </Card>

            <Card title={t("raschBandsTitle")} hint={t("raschBandsHint")}>
              <div className="flex flex-col gap-1">
                {data.bands.map((b) => {
                  const gap = b.items === 0 && b.persons > 0;
                  const thin = !gap && b.persons >= 3 * Math.max(b.items, 1) && b.items > 0;
                  return (
                    <div
                      key={b.from}
                      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-1.5 text-xs ${
                        gap ? "bg-warn-soft" : "bg-inset"
                      }`}
                    >
                      <span className="w-20 shrink-0 tabular-nums text-muted">
                        {b.from.toFixed(1)} … {(b.from + 0.5).toFixed(1)}
                      </span>
                      <span className="tabular-nums text-ink">
                        {t("raschMapPersons")}: {b.persons}
                      </span>
                      <span className="tabular-nums text-ink">
                        {t("raschMapItems")}: {b.items}
                      </span>
                      <span className="tabular-nums text-muted">
                        {t("raschSolvedShare", { n: Math.round(b.share * 100) })}
                      </span>
                      {gap && (
                        <span className="flex items-center gap-1 whitespace-nowrap font-medium text-warn">
                          <AlertTriangle size={12} /> {t("raschBandGap")}
                        </span>
                      )}
                      {thin && <span className="text-muted">{t("raschBandThin")}</span>}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Одномерность — условие пригодности самой модели, поэтому стоит
                выше диагностики отдельных заданий: если вариант меряет две
                величины, трудность каждого задания уже спорна. */}
            <Card
              title={t("raschDimensionTitle")}
              hint={t("raschDimensionHint", { threshold: data.dimension_threshold.toFixed(1) })}
            >
              {data.dimensionality.length === 0 ? (
                <p className="text-xs text-muted">{t("raschDimensionNone")}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {data.dimensionality.map((d) => (
                    <div key={d.exam_id} className="rounded-xl bg-inset p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-ink">{d.title}</span>
                        <span className="text-[11px] text-muted">
                          {d.items} · {d.persons}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                        <span className="text-xs text-muted">{t("raschContrast")}</span>
                        <span
                          className={`text-lg font-semibold tabular-nums ${
                            d.suspect ? "text-warn" : "text-ink"
                          }`}
                        >
                          {d.first_contrast.toFixed(2)}
                        </span>
                        <span className="text-xs text-muted">
                          {t("raschNoiseCeiling", { value: d.noise_ceiling.toFixed(2) })}
                        </span>
                        <span className={`text-xs ${d.suspect ? "text-warn" : "text-pos"}`}>
                          {d.suspect ? t("raschDimensionSuspect") : t("raschDimensionOk")}
                        </span>
                      </div>

                      {d.dependent.length > 0 && (
                        <div className="mt-2.5 rounded-lg bg-warn-soft p-2.5">
                          <p className="text-xs font-medium text-warn">
                            {t("raschDependentTitle")}
                          </p>
                          <div className="mt-1 flex flex-col gap-0.5">
                            {d.dependent.map((p) => (
                              <p
                                key={`${p.first}-${p.second}`}
                                className="text-xs tabular-nums text-warn"
                              >
                                {p.first} ↔ {p.second} ·{" "}
                                {t("raschDependentPair", { value: p.correlation.toFixed(2) })}
                              </p>
                            ))}
                          </div>
                          <p className="mt-1.5 text-xs leading-snug text-muted">
                            {t("raschDependentHint")}
                          </p>
                        </div>
                      )}

                      {d.suspect && (
                        <div className="mt-2.5 flex flex-col gap-1.5">
                          {[
                            { label: t("raschPoleTop"), items: d.top },
                            { label: t("raschPoleBottom"), items: d.bottom },
                          ].map((pole) => (
                            <p key={pole.label} className="text-xs text-muted">
                              <span className="text-ink">{pole.label}:</span>{" "}
                              {pole.items
                                .map((i) => `${i.code} (${i.loading.toFixed(2)})`)
                                .join(", ")}
                            </p>
                          ))}
                          <p className="text-xs leading-snug text-muted">{t("raschPoleHint")}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title={t("raschMisfitTitle")}>
              <p className="mb-1.5 text-xs font-medium text-ink">{t("raschUnderfit")}</p>
              <p className="mb-2.5 text-xs text-muted">{t("raschUnderfitHint")}</p>
              <MisfitList items={data.misfit.underfit} empty={t("raschMisfitNone")} />

              <p className="mt-3 text-xs leading-snug text-muted">{t("fitEnvelopeHint")}</p>

              <p className="mt-5 mb-1.5 text-xs font-medium text-ink">{t("raschOverfit")}</p>
              <p className="mb-2.5 text-xs text-muted">{t("raschOverfitHint")}</p>
              <MisfitList items={data.misfit.overfit} empty={t("raschMisfitNone")} />
            </Card>

            <Card title={t("raschDriftTitle")} hint={t("raschDriftHint")}>
              {data.drift.length === 0 ? (
                <p className="text-xs text-muted">{t("raschDriftNone")}</p>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    {data.drift.map((d) => (
                      <button
                        key={d.item_id}
                        type="button"
                        onClick={() => navigate(`/bank/item/${d.item_id}`)}
                        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-warn-soft px-3 py-2 text-left"
                      >
                        <span className="text-sm font-semibold tabular-nums text-ink">{d.code}</span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-warn">
                          <span>
                            {t("raschDriftValue", {
                              value: `${d.displacement > 0 ? "+" : ""}${d.displacement.toFixed(2)}`,
                            })}
                          </span>
                          <span className="text-muted">± {d.standard_error.toFixed(2)}</span>
                          <span className="text-muted">z {d.z.toFixed(1)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-snug text-muted">{t("raschDriftAction")}</p>
                </>
              )}
            </Card>

            <Card title={t("raschLinksTitle")} hint={t("raschLinksHint")}>
              <div className="flex flex-col gap-2">
                {data.links.map((l) => {
                  const best = Math.max(0, ...l.partners.map((p) => p.shared));
                  return (
                    <div key={l.exam_id} className="rounded-xl bg-inset p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-ink">{l.title}</span>
                        <span className="text-[11px] text-muted">
                          {t("raschCalibratedOf", { n: l.calibrated, total: l.items })}
                        </span>
                      </div>
                      {l.partners.length === 0 ? (
                        <p className="mt-1 flex items-center gap-1 text-xs text-warn">
                          <AlertTriangle size={12} /> {t("raschLinkAlone")}
                        </p>
                      ) : (
                        <div className="mt-1.5 flex flex-col gap-1">
                          {l.partners.map((p) => (
                            <p key={p.exam_id} className="text-xs text-muted">
                              {p.title} — {t("raschLinkShared", { n: p.shared })}
                              {p.stable !== p.shared && (
                                <span className="text-warn">
                                  {" · "}
                                  {t("raschStableOf", { n: p.stable, total: p.shared })}
                                </span>
                              )}
                              {p.stable < data.min_stable_anchors && (
                                <span className="text-neg">
                                  {" · "}
                                  {t("raschTooFewStable", { need: data.min_stable_anchors })}
                                </span>
                              )}
                            </p>
                          ))}
                          {best < RECOMMENDED_ANCHORS && (
                            <p className="flex items-center gap-1 text-xs text-warn">
                              <AlertTriangle size={12} />{" "}
                              {t("raschLinkWeak", { need: RECOMMENDED_ANCHORS })}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {data.links.length === 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <Minus size={12} /> —
                  </p>
                )}
              </div>
            </Card>

            {data.score_tables.length > 0 && (
              <Card title={t("equatedReference")} hint={t("equatedReferenceHint")}>
                <select
                  value={data.reference_exam_id ?? ""}
                  onChange={(e) => setReference.mutate(Number(e.target.value))}
                  disabled={setReference.isPending}
                  className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-ink disabled:opacity-50 sm:w-auto"
                >
                  {data.score_tables.map((s) => (
                    <option key={s.exam_id} value={s.exam_id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </Card>
            )}

            {table && (
              <Card title={t("raschScoreTitle")} hint={t("raschScoreHint")}>
                {data.score_tables.length > 1 && (
                  <select
                    value={table.exam_id}
                    onChange={(e) => setTableExam(Number(e.target.value))}
                    className="mb-3 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-ink sm:w-auto"
                  >
                    {data.score_tables.map((s) => (
                      <option key={s.exam_id} value={s.exam_id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                )}
                <div className="max-h-72 overflow-y-auto rounded-xl bg-inset p-3">
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-1.5">
                    {table.rows.map((r) => (
                      <div key={r.raw} className="rounded-lg bg-card px-2 py-1.5 text-center">
                        <p className="text-[10px] text-muted">
                          {t("raschScoreRaw")} {r.raw}
                        </p>
                        <p className="text-sm font-semibold tabular-nums text-ink">
                          {r.logit > 0 ? "+" : ""}
                          {r.logit.toFixed(2)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}

            <Card title={t("raschHistoryTitle")} hint={t("raschHistoryHint")}>
              <div className="flex flex-col gap-1">
                {data.history.map((h) => (
                  <div
                    key={h.run_id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-1.5 text-xs"
                  >
                    <span className="text-muted">{formatDateTime(h.run_at)}</span>
                    <span className="tabular-nums text-ink">
                      {t("raschHistoryRow", { persons: h.persons, items: h.items })}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </main>
    </>
  );
}
