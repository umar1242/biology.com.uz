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

/**
 * Матрица корреляций остатков. Раш-измерение из данных уже вычтено, поэтому
 * то, что здесь коррелирует, модель не объяснила: либо второе измерение
 * (тогда корреляции размазаны по группе заданий), либо зависимость пары
 * (тогда это одна яркая клетка).
 */
function residualCorrelationMatrix(
  usable: Cell[],
  itemIds: number[],
  personIds: number[],
  difficulties: Map<number, number>,
  abilities: Map<number, number>,
): number[][] | null {
  const itemIndex = new Map(itemIds.map((id, i) => [id, i]));
  const personIndex = new Map(personIds.map((id, i) => [id, i]));

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
  return corr;
}

/**
 * Локальная независимость (Q₃ Йена): пары заданий, чьи остатки ходят вместе.
 *
 * Модель Раша требует, чтобы после учёта подготовки ответы на разные задания
 * были независимы. Два задания на общем тексте это требование нарушают по
 * построению: кто понял текст, решит оба, кто не понял — провалит оба, и
 * подготовка тут ни при чём. Платформа это касается напрямую: по
 * спецификации задания 33–35 сидят на одном тексте.
 *
 * Чем это вредно: зависимая пара считается за два независимых измерения, и
 * тест выглядит надёжнее, чем он есть. Разделяющая способность завышается.
 *
 * Отсчёт ведётся от среднего по всем парам: у Q₃ есть известное смещение
 * вниз, примерно −1/(L−1), потому что остатки связаны общей оценкой. Флаг
 * ставится на превышение среднего, а не самого нуля.
 *
 * Порог — не константа. Пар в матрице сотни (у сорока заданий их 780), и при
 * такой множественности самая большая корреляция даже на независимых данных
 * заметно выше нуля просто по случайности. Поэтому потолок считается
 * симуляцией: по оценённым параметрам порождаются заведомо независимые
 * наборы, у каждого берётся НАИБОЛЬШЕЕ превышение, и планкой становится верх
 * этого разброса. Ровно так же устроены потолок первого контраста и полоса
 * соответствия — одна болезнь, одно лекарство.
 */
export type DependentPair = {
  first: number;
  second: number;
  correlation: number;
  /** Превышение над средней корреляцией по всем парам. */
  excess: number;
};

/** Ниже этого превышение не считается содержательным, что бы ни сказала симуляция. */
export const Q3_EXCESS_THRESHOLD = 0.2;

const DEFAULT_Q3_SIMULATIONS = 24;

export function analyseLocalIndependence(params: {
  responses: Cell[];
  difficulties: Map<number, number>;
  abilities: Map<number, number>;
  simulations?: number;
}): { pairs: DependentPair[]; meanCorrelation: number; ceiling: number } | null {
  const usable = params.responses.filter(
    (r) => params.difficulties.has(r.itemId) && params.abilities.has(r.personId),
  );
  const itemIds = [...new Set(usable.map((r) => r.itemId))].sort((a, b) => a - b);
  const personIds = [...new Set(usable.map((r) => r.personId))].sort((a, b) => a - b);
  if (itemIds.length < MIN_ITEMS || personIds.length < MIN_PERSONS) return null;

  const corr = residualCorrelationMatrix(
    usable,
    itemIds,
    personIds,
    params.difficulties,
    params.abilities,
  );
  if (!corr) return null;

  const values: number[] = [];
  for (let a = 0; a < itemIds.length; a += 1) {
    for (let b = a + 1; b < itemIds.length; b += 1) values.push(corr[a][b]);
  }
  const meanCorrelation = values.reduce((s, v) => s + v, 0) / values.length;

  // Потолок: наибольшее превышение, какое даёт заведомо независимый набор
  // такой же формы. Зерно выведено из формы задачи — ответ не должен меняться
  // от пересчёта к пересчёту на одних и тех же данных.
  const simulations = params.simulations ?? DEFAULT_Q3_SIMULATIONS;
  const rand = mulberry32(itemIds.length * 7919 + personIds.length);
  const maxima: number[] = [];
  for (let s = 0; s < simulations; s += 1) {
    const simulated = usable.map((r) => ({
      personId: r.personId,
      itemId: r.itemId,
      correct:
        rand() <
        probability(
          params.abilities.get(r.personId) as number,
          params.difficulties.get(r.itemId) as number,
        ),
    }));
    const m = residualCorrelationMatrix(
      simulated,
      itemIds,
      personIds,
      params.difficulties,
      params.abilities,
    );
    if (!m) continue;
    let sum = 0;
    let count = 0;
    let best = -Infinity;
    for (let a = 0; a < itemIds.length; a += 1) {
      for (let b = a + 1; b < itemIds.length; b += 1) {
        sum += m[a][b];
        count += 1;
      }
    }
    const simulatedMean = sum / count;
    for (let a = 0; a < itemIds.length; a += 1) {
      for (let b = a + 1; b < itemIds.length; b += 1) {
        best = Math.max(best, m[a][b] - simulatedMean);
      }
    }
    maxima.push(best);
  }
  maxima.sort((a, b) => a - b);
  const simulated = maxima.length
    ? maxima[Math.min(maxima.length - 1, Math.floor(maxima.length * 0.95))]
    : Q3_EXCESS_THRESHOLD;
  const ceiling = Math.max(simulated, Q3_EXCESS_THRESHOLD);

  const pairs: DependentPair[] = [];
  for (let a = 0; a < itemIds.length; a += 1) {
    for (let b = a + 1; b < itemIds.length; b += 1) {
      const excess = corr[a][b] - meanCorrelation;
      if (excess > ceiling) {
        pairs.push({
          first: itemIds[a],
          second: itemIds[b],
          correlation: Math.round(corr[a][b] * 1000) / 1000,
          excess: Math.round(excess * 1000) / 1000,
        });
      }
    }
  }

  return {
    pairs: pairs.sort((x, y) => y.excess - x.excess),
    meanCorrelation: Math.round(meanCorrelation * 1000) / 1000,
    ceiling: Math.round(ceiling * 1000) / 1000,
  };
}

function firstContrastOf(
  usable: Cell[],
  itemIds: number[],
  personIds: number[],
  difficulties: Map<number, number>,
  abilities: Map<number, number>,
): { eigenvalue: number; vector: number[] } | null {
  const corr = residualCorrelationMatrix(usable, itemIds, personIds, difficulties, abilities);
  if (!corr) return null;
  const n = itemIds.length;

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
