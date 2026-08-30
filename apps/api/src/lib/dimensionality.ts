/**
 * Проверка одномерности: меряет ли вариант одну величину или две.
 *
 * Модель Раша построена на допущении, что за всеми ответами стоит один
 * латентный параметр — подготовка. Если в тесте намешано две разные
 * способности (скажем, знание биологии и умение читать сложный текст), то
 * общая шкала складывает несравнимое, и трудность задания перестаёт быть
 * свойством задания. Летова прямо ставит одномерность первым условием
 * пригодности модели, и до сих пор мы её не проверяли.
 *
 * Метод — анализ главных компонент остатков (PCA of residuals, Linacre).
 * Раш-измерение из данных уже вычтено: остаток z = (x − P)/√(P(1−P)) — это
 * то, чего модель НЕ объяснила. Если остатки независимы, их корреляционная
 * матрица близка к единичной и все собственные значения около единицы. Если
 * же группа заданий систематически «промахивается» в одну сторону у одних и
 * тех же учеников, эта группа даёт большое первое собственное значение —
 * первый контраст.
 *
 * Известное правило Linacre — «ниже 2.0 второго измерения нет» — здесь как
 * решающее НЕ годится, и это проверено на своих же данных: демо-вариант
 * порождён строго одномерной моделью, а контраст вышел 2.9. Причина в форме
 * матрицы: наибольшее собственное значение чисто случайной корреляционной
 * матрицы растёт с отношением числа заданий к числу учеников примерно как
 * (1 + √(n/N))², и при 40 заданиях на 120 учеников шум сам по себе даёт около
 * 2.5. Порог 2.0 выведен для выборок, где учеников на порядок больше.
 *
 * Поэтому потолок шума считается для КОНКРЕТНОЙ матрицы: по оценённым
 * параметрам генерируется несколько заведомо одномерных наборов ответов, у
 * каждого измеряется первый контраст, и берётся верхняя граница полученного
 * разброса. Подозрение объявляется, только если настоящий контраст её
 * превысил. Так решающее правило не зависит от размера когорты.
 *
 * Считается ПО ОДНОМУ ВАРИАНТУ. Матрица остатков должна быть полной: ученик
 * отвечает на весь вариант, но не на весь банк, и корреляция между заданиями
 * из разных вариантов не определена — общих учеников у них попросту нет.
 */

export type ContrastLoading = {
  itemId: number;
  /** Нагрузка на первый контраст. Полюса (крайние + и −) — два кластера. */
  loading: number;
};

export type DimensionalityResult = {
  items: number;
  persons: number;
  /** Собственное значение первого контраста, в «единицах заданий». */
  firstContrast: number;
  /** Столько даёт чистый шум на матрице такой же формы (верх разброса). */
  noiseCeiling: number;
  /** Контраст выше потолка шума — есть на что смотреть. */
  suspect: boolean;
  loadings: ContrastLoading[];
};

const MIN_ITEMS = 5;
const MIN_PERSONS = 20;

/** Классический ориентир Linacre. Показывается для сравнения, но решает не он. */
export const SECOND_DIMENSION_THRESHOLD = 2.0;

/** Сколько одномерных наборов генерируется для оценки потолка шума. */
const DEFAULT_SIMULATIONS = 24;

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

type Cell = { personId: number; itemId: number; correct: boolean };

function firstContrastOf(
  usable: Cell[],
  itemIds: number[],
  personIds: number[],
  difficulties: Map<number, number>,
  abilities: Map<number, number>,
): { eigenvalue: number; vector: number[] } | null {
  const itemIndex = new Map(itemIds.map((id, i) => [id, i]));
  const personIndex = new Map(personIds.map((id, i) => [id, i]));

  // Остатки: null там, где ученик задания не видел.
  const residual: (number | null)[][] = personIds.map(() => itemIds.map(() => null));
  for (const r of usable) {
    const p = probability(
      abilities.get(r.personId) as number,
      difficulties.get(r.itemId) as number,
    );
    const variance = p * (1 - p);
    if (variance <= 1e-9) continue;
    residual[personIndex.get(r.personId) as number][itemIndex.get(r.itemId) as number] =
      ((r.correct ? 1 : 0) - p) / Math.sqrt(variance);
  }

  // Корреляции остатков по парам заданий, по общим ученикам.
  const n = itemIds.length;
  const corr: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let a = 0; a < n; a += 1) {
    corr[a][a] = 1;
    for (let b = a + 1; b < n; b += 1) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let p = 0; p < personIds.length; p += 1) {
        const x = residual[p][a];
        const y = residual[p][b];
        if (x === null || y === null) continue;
        xs.push(x);
        ys.push(y);
      }
      let c = 0;
      if (xs.length >= 3) {
        const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
        const my = ys.reduce((s, v) => s + v, 0) / ys.length;
        let sxy = 0;
        let sxx = 0;
        let syy = 0;
        for (let i = 0; i < xs.length; i += 1) {
          sxy += (xs[i] - mx) * (ys[i] - my);
          sxx += (xs[i] - mx) ** 2;
          syy += (ys[i] - my) ** 2;
        }
        c = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
      }
      corr[a][b] = c;
      corr[b][a] = c;
    }
  }

  // Наибольшее собственное значение и вектор — степенным методом. Матрица
  // симметрична, поэтому итерации сходятся к первой компоненте.
  let vector = new Array(n).fill(1 / Math.sqrt(n));
  let eigenvalue = 0;
  for (let step = 0; step < 300; step += 1) {
    const next = new Array(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) next[i] += corr[i][j] * vector[j];
    }
    const norm = Math.sqrt(next.reduce((s, v) => s + v * v, 0));
    if (norm < 1e-12) return null;
    const normalized = next.map((v) => v / norm);
    const change = normalized.reduce((m, v, i) => Math.max(m, Math.abs(v - vector[i])), 0);
    vector = normalized;
    eigenvalue = norm;
    if (change < 1e-10) break;
  }

  return { eigenvalue, vector };
}

export function analyseDimensionality(params: {
  responses: Cell[];
  difficulties: Map<number, number>;
  abilities: Map<number, number>;
  simulations?: number;
}): DimensionalityResult | null {
  const { difficulties, abilities } = params;
  const simulations = params.simulations ?? DEFAULT_SIMULATIONS;

  const usable = params.responses.filter(
    (r) => difficulties.has(r.itemId) && abilities.has(r.personId),
  );
  const itemIds = [...new Set(usable.map((r) => r.itemId))].sort((a, b) => a - b);
  const personIds = [...new Set(usable.map((r) => r.personId))].sort((a, b) => a - b);
  if (itemIds.length < MIN_ITEMS || personIds.length < MIN_PERSONS) return null;

  const observed = firstContrastOf(usable, itemIds, personIds, difficulties, abilities);
  if (!observed) return null;

  // Потолок шума: те же люди, те же задания, ответы порождены одномерной
  // моделью. Зерно ГСЧ выведено из формы матрицы, поэтому ответ на одних и
  // тех же данных не меняется от прогона к прогону.
  const rand = mulberry32(itemIds.length * 1000 + personIds.length);
  const noise: number[] = [];
  for (let s = 0; s < simulations; s += 1) {
    const simulated = usable.map((r) => ({
      personId: r.personId,
      itemId: r.itemId,
      correct:
        rand() <
        probability(abilities.get(r.personId) as number, difficulties.get(r.itemId) as number),
    }));
    const result = firstContrastOf(simulated, itemIds, personIds, difficulties, abilities);
    if (result) noise.push(result.eigenvalue);
  }
  noise.sort((a, b) => a - b);
  const ceiling = noise.length
    ? noise[Math.min(noise.length - 1, Math.floor(noise.length * 0.95))]
    : SECOND_DIMENSION_THRESHOLD;

  // Знак вектора произволен: закрепляем его так, чтобы у большинства заданий
  // нагрузка была положительной — иначе полюса меняются местами от прогона
  // к прогону и читать таблицу невозможно.
  const n = itemIds.length;
  const positives = observed.vector.filter((v) => v > 0).length;
  const sign = positives * 2 >= n ? 1 : -1;
  const scale = Math.sqrt(Math.max(observed.eigenvalue, 0));

  return {
    items: n,
    persons: personIds.length,
    firstContrast: Math.round(observed.eigenvalue * 1000) / 1000,
    noiseCeiling: Math.round(ceiling * 1000) / 1000,
    suspect: observed.eigenvalue > ceiling,
    loadings: itemIds
      .map((id, i) => ({
        itemId: id,
        loading: Math.round(sign * observed.vector[i] * scale * 1000) / 1000,
      }))
      .sort((a, b) => b.loading - a.loading),
  };
}
