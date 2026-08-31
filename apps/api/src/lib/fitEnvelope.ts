/**
 * Полосы соответствия, посчитанные по этим самым данным, а не взятые из книги.
 *
 * Проблема с постоянным порогом. Средний квадрат остатков (MNSQ) — величина
 * со своим разбросом, и разброс этот зависит от числа ответов: примерно
 * √(2/N). При тридцати ответах он равен 0.26, и привычная полоса 0.7–1.3
 * отстоит от единицы всего на 1.15 стандартного отклонения — каждое четвёртое
 * исправное задание получит обвинение. При пятистах ответах тот же разброс
 * равен 0.063, и та же полоса становится пятью сигмами, то есть не ловит уже
 * ничего. Одна константа не может быть верной в обоих случаях.
 *
 * Разброс зависит ещё и от нацеленности: у задания, стоящего далеко от
 * подготовки группы, ответы почти детерминированы, и остатки ведут себя иначе,
 * чем у задания, которое для группы пятьдесят на пятьдесят.
 *
 * Поэтому полоса считается для каждого задания отдельно: по оценённым
 * параметрам генерируется несколько заведомо исправных наборов ответов — те же
 * люди, те же задания, та же схема кто-кому-отвечал, — у каждого меряется
 * MNSQ, и берутся крайние проценты полученного разброса. Наблюдённое значение
 * сравнивается со своей полосой, а не с чужой.
 *
 * Тот же механизм уже стоит на первом контрасте главных компонент: там
 * постоянный порог 2.0 давал ложную тревогу ровно по той же причине.
 *
 * Оговорка. Параметры оценены по наблюдённым данным, а симуляции порождаются
 * при известных параметрах. Наблюдённые остатки поэтому чуть меньше
 * симулированных: модель подогнана под собственные данные. Смещение работает
 * в сторону осторожности для недостатка соответствия (реже обвиняем) и против
 * — для избытка (чаще). Учитывать его точнее значило бы пересчитывать
 * параметры на каждой симуляции, что дороже пользы.
 */
import type { RaschResponse } from "./rasch.js";

export type FitEnvelope = {
  itemId: number;
  infitLow: number;
  infitHigh: number;
  outfitLow: number;
  outfitHigh: number;
  simulations: number;
};

/** Двусторонняя полоса: сколько процентов разброса остаётся снаружи с каждой стороны. */
const TAIL = 0.025;

const DEFAULT_SIMULATIONS = 50;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function probability(ability: number, difficulty: number): number {
  return 1 / (1 + Math.exp(-(ability - difficulty)));
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index];
}

/** Соответствие одного задания по готовой матрице ответов. */
export function fitOf(
  cells: { probability: number; correct: boolean }[],
): { infit: number; outfit: number } {
  let squared = 0;
  let weighted = 0;
  let information = 0;
  for (const c of cells) {
    const variance = c.probability * (1 - c.probability);
    if (variance <= 1e-9) continue;
    const residual = (c.correct ? 1 : 0) - c.probability;
    squared += (residual * residual) / variance;
    weighted += residual * residual;
    information += variance;
  }
  const n = cells.length;
  return {
    outfit: n > 0 ? squared / n : 1,
    infit: information > 0 ? weighted / information : 1,
  };
}

export function simulateFitEnvelopes(params: {
  /** Наблюдённая схема: кто на какое задание отвечал. Сами ответы не нужны. */
  responses: RaschResponse[];
  difficulties: Map<number, number>;
  abilities: Map<number, number>;
  simulations?: number;
  seed?: number;
}): Map<number, FitEnvelope> {
  const { responses, difficulties, abilities } = params;
  const simulations = params.simulations ?? DEFAULT_SIMULATIONS;

  const byItem = new Map<number, number[]>();
  for (const r of responses) {
    const b = difficulties.get(r.itemId);
    const theta = abilities.get(r.personId);
    if (b === undefined || theta === undefined) continue;
    const list = byItem.get(r.itemId) ?? [];
    list.push(probability(theta, b));
    byItem.set(r.itemId, list);
  }

  // Зерно выводится из формы задачи, а не из часов: одна и та же матрица
  // должна давать одну и ту же полосу, иначе задание будет то в полосе, то
  // вне её при каждом пересчёте.
  const rand = mulberry32(params.seed ?? responses.length * 31 + byItem.size);

  const out = new Map<number, FitEnvelope>();
  for (const [itemId, probabilities] of byItem) {
    const infits: number[] = [];
    const outfits: number[] = [];
    for (let s = 0; s < simulations; s += 1) {
      const cells = probabilities.map((p) => ({ probability: p, correct: rand() < p }));
      const fit = fitOf(cells);
      infits.push(fit.infit);
      outfits.push(fit.outfit);
    }
    infits.sort((a, b) => a - b);
    outfits.sort((a, b) => a - b);
    out.set(itemId, {
      itemId,
      infitLow: Math.round(percentile(infits, TAIL) * 1000) / 1000,
      infitHigh: Math.round(percentile(infits, 1 - TAIL) * 1000) / 1000,
      outfitLow: Math.round(percentile(outfits, TAIL) * 1000) / 1000,
      outfitHigh: Math.round(percentile(outfits, 1 - TAIL) * 1000) / 1000,
      simulations,
    });
  }
  return out;
}

export type FitVerdict = "productive" | "underfit" | "overfit";

/**
 * Вердикт по наблюдённому значению и его собственной полосе.
 *
 * Полоса — это разброс исправного задания. Выход за неё означает «так
 * исправное задание себя почти не ведёт», и порог здесь не назначен рукой, а
 * измерен на этой же матрице.
 */
export function fitVerdict(
  outfit: number,
  envelope: { outfitLow: number; outfitHigh: number } | null,
): FitVerdict {
  if (!envelope || !Number.isFinite(envelope.outfitHigh)) {
    // Без полосы — прежние книжные границы: лучше грубый порог, чем никакого.
    if (outfit > 1.5) return "underfit";
    if (outfit < 0.5) return "overfit";
    return "productive";
  }
  if (outfit > envelope.outfitHigh) return "underfit";
  if (outfit < envelope.outfitLow) return "overfit";
  return "productive";
}
