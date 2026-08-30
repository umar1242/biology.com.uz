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
  responses: number;
  state: "none" | "provisional" | "stable";
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
  bands: { from: number; persons: number; items: number }[];
  separation: { index: number; reliability: number; strata: number } | null;
  misfit: { underfit: OverviewItem[]; overfit: OverviewItem[] };
  links: {
    exam_id: number;
    title: string;
    items: number;
    calibrated: number;
    partners: { exam_id: number; title: string; shared: number }[];
  }[];
  score_tables: {
    exam_id: number;
    title: string;
    items: number;
    rows: { raw: number; logit: number }[];
  }[];
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
 * Карта Райта: одна шкала логитов, ученики слева, задания справа.
 *
 * Две гистограммы вокруг общей оси, а не два отдельных графика: смысл карты
 * в том, что находится НАПРОТИВ друг друга, и раздельные оси этот смысл
 * теряют. Ось идёт сверху вниз от трудного к лёгкому — так её печатают в
 * учебниках, и так же читается «выше = сильнее».
 */
function WrightMap({ map }: { map: Overview["map"] }) {
  const { t } = useI18n();
  const rows = useMemo(() => [...map.rows].sort((a, b) => b.from - a.from), [map.rows]);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.persons, r.items)));

  return (
    <div>
      <div className="mb-2 flex items-end justify-between text-[11px] text-muted">
        <span>
          {t("raschMapPersons")} · {map.persons}
          {map.person_mean !== null &&
            ` · ${t("raschMeanLine", { value: map.person_mean.toFixed(2) })}`}
        </span>
        <span className="text-right">
          {t("raschMapItems")} · {map.items}
          {map.item_mean !== null &&
            ` · ${t("raschMeanLine", { value: map.item_mean.toFixed(2) })}`}
        </span>
      </div>

      <div className="flex flex-col gap-px">
        {rows.map((r) => {
          // Целые логиты получают подпись и более заметную линию — иначе
          // шкала из 40 строк по 0.25 читается как полосатый ковёр.
          const whole = Math.abs(r.from - Math.round(r.from)) < 1e-9;
          return (
            <div key={r.from} className="flex items-center gap-2">
              <div className="flex h-3.5 flex-1 items-center justify-end">
                {r.persons > 0 && (
                  <div
                    className="h-2.5 rounded-l-sm bg-accent"
                    style={{ width: `${(r.persons / max) * 100}%` }}
                    title={`${r.persons}`}
                  />
                )}
              </div>
              <span
                className={`w-11 shrink-0 text-center text-[10px] tabular-nums ${
                  whole ? "font-semibold text-ink" : "text-muted/60"
                }`}
              >
                {whole ? r.from.toFixed(0) : ""}
              </span>
              <div className="flex h-3.5 flex-1 items-center">
                {r.items > 0 && (
                  <div
                    className="h-2.5 rounded-r-sm bg-ink"
                    style={{ width: `${(r.items / max) * 100}%` }}
                    title={`${r.items}`}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MisfitList({ items, empty }: { items: OverviewItem[]; empty: string }) {
  const navigate = useNavigate();
  if (items.length === 0) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          onClick={() => navigate(`/bank/item/${i.id}`)}
          className="flex items-center justify-between gap-3 rounded-xl bg-inset px-3 py-2 text-left hover:bg-warn-soft"
        >
          <span className="text-sm font-semibold tabular-nums text-ink">{i.code}</span>
          <span className="flex items-center gap-3 text-xs tabular-nums text-muted">
            <span>b {i.difficulty.toFixed(2)}</span>
            <span>infit {i.infit.toFixed(2)}</span>
            <span className="font-semibold text-ink">outfit {i.outfit.toFixed(2)}</span>
            <span>{i.responses}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function RaschPage() {
  const { t, formatDateTime } = useI18n();
  const queryClient = useQueryClient();
  const [tableExam, setTableExam] = useState<number | null>(null);

  const overview = useQuery({
    queryKey: ["cert-calibration-overview"],
    queryFn: () => apiFetch<Overview>("/cert-calibration/overview"),
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
              <WrightMap map={data.map} />
            </Card>

            <Card title={t("raschBandsTitle")} hint={t("raschBandsHint")}>
              <div className="flex flex-col gap-1">
                {data.bands.map((b) => {
                  const gap = b.items === 0 && b.persons > 0;
                  const thin = !gap && b.persons >= 3 * Math.max(b.items, 1) && b.items > 0;
                  return (
                    <div
                      key={b.from}
                      className={`flex items-center gap-3 rounded-lg px-3 py-1.5 text-xs ${
                        gap ? "bg-warn-soft" : "bg-inset"
                      }`}
                    >
                      <span className="w-24 shrink-0 tabular-nums text-muted">
                        {b.from.toFixed(1)} … {(b.from + 0.5).toFixed(1)}
                      </span>
                      <span className="w-24 shrink-0 tabular-nums text-ink">
                        {t("raschMapPersons")}: {b.persons}
                      </span>
                      <span className="w-24 shrink-0 tabular-nums text-ink">
                        {t("raschMapItems")}: {b.items}
                      </span>
                      {gap && (
                        <span className="flex items-center gap-1 font-medium text-warn">
                          <AlertTriangle size={12} /> {t("raschBandGap")}
                        </span>
                      )}
                      {thin && <span className="text-muted">{t("raschBandThin")}</span>}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title={t("raschMisfitTitle")}>
              <p className="mb-1.5 text-xs font-medium text-ink">{t("raschUnderfit")}</p>
              <p className="mb-2.5 text-xs text-muted">{t("raschUnderfitHint")}</p>
              <MisfitList items={data.misfit.underfit} empty={t("raschMisfitNone")} />

              <p className="mt-5 mb-1.5 text-xs font-medium text-ink">{t("raschOverfit")}</p>
              <p className="mb-2.5 text-xs text-muted">{t("raschOverfitHint")}</p>
              <MisfitList items={data.misfit.overfit} empty={t("raschMisfitNone")} />
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
