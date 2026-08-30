/**
 * Частично-кредитная модель Мастерса (Partial Credit Model) — модель Раша для
 * заданий, которые оцениваются не «верно/неверно», а баллами.
 *
 * Зачем: задания 41–43 стоят 30, 35 и 10 баллов, и дихотомическая модель про
 * них молчит — до сих пор они просто выпадали из калибровки. Между тем это
 * половина веса сертификата, и трудность у них тоже есть.
 *
 * Модель говорит, что переход из категории k−1 в k — это своё маленькое
 * испытание со своим порогом δ_k:
 *
 *     P(X = k) = exp(Σ_{j≤k} (θ − δ_j)) / Σ_h exp(Σ_{j≤h} (θ − δ_j))
 *
 * Трудность задания целиком — среднее его порогов.
 *
 * Оценка идёт при ЗАФИКСИРОВАННЫХ способностях: подготовка ученика уже
 * измерена сорока дихотомическими заданиями, где информации несравнимо
 * больше, и позволять трём письменным работам её пересчитывать не стоит. При
 * фиксированных θ задания независимы друг от друга и считаются по отдельности.
 *
 * Достаточная статистика порога δ_j — число учеников, добравшихся до категории
 * j или выше. Уравнение T_j = Σ_n P_n(X ≥ j) монотонно по δ_j, поэтому
 * решается делением пополам: без производных, без риска разойтись.
 */

export type PolytomousResponse = {
  personId: number;
  itemId: number;
  /** Категория 0..m. Баллы должны быть сведены в несколько ступеней заранее. */
  category: number;
};

export type PcmItemEstimate = {
  itemId: number;
  /** Пороги в логитах, по одному на каждый переход между категориями. */
  thresholds: number[];
  /** Трудность задания целиком — среднее порогов. */
  difficulty: number;
  standardError: number;
  responses: number;
  infit: number;
  outfit: number;
  /**
   * Категории, которых никто не занял, склеиваются перед оценкой: у пустой
   * ступени порог уходит в бесконечность. Здесь — сколько ступеней осталось.
   */
  categories: number;
  collapsed: boolean;
};

export type PcmResult = {
  items: PcmItemEstimate[];
  /** Задания, где все ответы попали в одну категорию: измерять нечего. */
  excludedItems: number[];
};

/** Вероятности категорий 0..m при подготовке θ и порогах δ. */
export function categoryProbabilities(theta: number, thresholds: readonly number[]): number[] {
  const logits: number[] = [0];
  let running = 0;
  for (const d of thresholds) {
    running += theta - d;
    logits.push(running);
  }
  // Вычитание максимума перед exp: без него exp(θ−δ) переполняется на
  // длинных шкалах и все вероятности схлопываются в NaN.
  const max = Math.max(...logits);
  const weights = logits.map((l) => Math.exp(l - max));
  const total = weights.reduce((s, w) => s + w, 0);
  return weights.map((w) => w / total);
}

function expectedAndVariance(theta: number, thresholds: readonly number[]) {
  const probabilities = categoryProbabilities(theta, thresholds);
  let expected = 0;
  let second = 0;
  for (let k = 0; k < probabilities.length; k += 1) {
    expected += k * probabilities[k];
    second += k * k * probabilities[k];
  }
  return { expected, variance: Math.max(second - expected * expected, 1e-9) };
}

function probabilityAtLeast(theta: number, thresholds: readonly number[], j: number): number {
  const probabilities = categoryProbabilities(theta, thresholds);
  let sum = 0;
  for (let k = j; k < probabilities.length; k += 1) sum += probabilities[k];
  return sum;
}

export function calibratePartialCredit(params: {
  responses: PolytomousResponse[];
  abilities: Map<number, number>;
  maxIterations?: number;
  convergence?: number;
}): PcmResult {
  const { responses, abilities } = params;
  const maxIterations = params.maxIterations ?? 100;
  const convergence = params.convergence ?? 0.001;

  const byItem = new Map<number, { theta: number; category: number }[]>();
  for (const r of responses) {
    const theta = abilities.get(r.personId);
    if (theta === undefined) continue;
    const list = byItem.get(r.itemId) ?? [];
    list.push({ theta, category: r.category });
    byItem.set(r.itemId, list);
  }

  const items: PcmItemEstimate[] = [];
  const excludedItems: number[] = [];

  for (const [itemId, rows] of [...byItem.entries()].sort((a, b) => a[0] - b[0])) {
    // Склейка пустых категорий: остаются только те ступени, которые кто-то
    // занял, и они перенумеровываются подряд.
    const present = [...new Set(rows.map((r) => r.category))].sort((a, b) => a - b);
    if (present.length < 2) {
      excludedItems.push(itemId);
      continue;
    }
    const rank = new Map(present.map((c, i) => [c, i]));
    const observed = rows.map((r) => ({ theta: r.theta, k: rank.get(r.category) as number }));
    const m = present.length - 1;

    // Достаточные статистики: сколько учеников дошли до ступени j и выше.
    const atLeast = Array.from({ length: m + 1 }, (_, j) =>
      observed.filter((o) => o.k >= j).length,
    );

    // Стартовые пороги — логарифмы шансов дойти до ступени, как и в
    // дихотомическом случае.
    const thresholds = Array.from({ length: m }, (_, idx) => {
      const j = idx + 1;
      const share = atLeast[j] / observed.length;
      const clamped = Math.min(Math.max(share, 1 / (observed.length + 1)), 1 - 1 / (observed.length + 1));
      return Math.log((1 - clamped) / clamped);
    });

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      let maxChange = 0;
      for (let idx = 0; idx < m; idx += 1) {
        const j = idx + 1;
        const target = atLeast[j];
        // Чем выше порог, тем меньше учеников его берут: функция убывает,
        // значит корень ловится делением пополам.
        let lo = -12;
        let hi = 12;
        for (let step = 0; step < 60; step += 1) {
          const mid = (lo + hi) / 2;
          const trial = [...thresholds];
          trial[idx] = mid;
          const expected = observed.reduce(
            (sum, o) => sum + probabilityAtLeast(o.theta, trial, j),
            0,
          );
          if (expected > target) lo = mid;
          else hi = mid;
        }
        const next = (lo + hi) / 2;
        maxChange = Math.max(maxChange, Math.abs(next - thresholds[idx]));
        thresholds[idx] = next;
      }
      if (maxChange < convergence) break;
    }

    let squared = 0;
    let weighted = 0;
    let information = 0;
    for (const o of observed) {
      const { expected, variance } = expectedAndVariance(o.theta, thresholds);
      const residual = o.k - expected;
      squared += (residual * residual) / variance;
      weighted += residual * residual;
      information += variance;
    }

    items.push({
      itemId,
      thresholds: thresholds.map((d) => Math.round(d * 1000) / 1000),
      difficulty: thresholds.reduce((s, d) => s + d, 0) / m,
      standardError: information > 0 ? 1 / Math.sqrt(information) : Number.POSITIVE_INFINITY,
      responses: observed.length,
      outfit: squared / observed.length,
      infit: information > 0 ? weighted / information : 1,
      categories: m + 1,
      collapsed: present.length !== present[present.length - 1] - present[0] + 1,
    });
  }

  return { items, excludedItems };
}

/**
 * Сводит баллы задания в несколько упорядоченных ступеней.
 *
 * Тридцать баллов — это тридцать порогов, каждому из которых нужны наблюдения
 * по обе стороны. На шестидесяти учениках это заведомо безнадёжно, поэтому
 * баллы огрубляются до пяти ступеней: ноль, четверть, половина, три четверти,
 * почти всё. Потеря точности здесь дешевле, чем пороги, оценённые по двум
 * наблюдениям.
 */
export const PCM_CATEGORY_COUNT = 5;

export function bandPoints(points: number, maxPoints: number): number {
  if (maxPoints <= 0) return 0;
  const share = Math.min(Math.max(points / maxPoints, 0), 1);
  return Math.round(share * (PCM_CATEGORY_COUNT - 1));
}
