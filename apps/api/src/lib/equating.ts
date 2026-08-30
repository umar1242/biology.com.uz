/**
 * Перевод результата ученика на общую шкалу банка.
 *
 * Задача, которую это решает: два варианта разной трудности дают одинаковой
 * сумме верных разный смысл. Тридцать заданий на трудном варианте — не то же
 * самое, что тридцать на лёгком, и без поправки два потока сравнивать нельзя.
 *
 * Взвешивать задания по трудности для этого нельзя — в модели Раша сумма
 * верных является достаточной статистикой, и веса только добавляют шум
 * (проверено на синтетике: любое взвешивание по трудности меряет хуже простого
 * подсчёта). Трудность входит в оценку иначе — через форму перевода суммы в
 * шкалу, и этим занимается здешний код.
 *
 * Порядок такой:
 *   сумма верных → уровень θ по трудностям СВОЕГО варианта
 *   θ → сколько бы он решил на ЭТАЛОННОМ варианте
 * и уже это число идёт в государственную формулу вместо сырого.
 */

function probability(measure: number, difficulty: number): number {
  return 1 / (1 + Math.exp(-(measure - difficulty)));
}

/** Ожидаемое число верных у ученика с подготовкой θ на этом наборе заданий. */
export function expectedCorrect(measure: number, difficulties: readonly number[]): number {
  return difficulties.reduce((sum, b) => sum + probability(measure, b), 0);
}

/**
 * Обратная задача: какой подготовке отвечает такая сумма верных.
 *
 * Ожидаемое число верных строго растёт по θ, поэтому решение единственно и
 * находится делением пополам — без производных и без риска разойтись.
 *
 * Ноль верных и все верные не имеют конечного ответа: правдоподобие растёт
 * бесконечно в обе стороны. Возвращается null, и вызывающий обязан сказать
 * «ниже измеримого» вместо выдуманного числа.
 */
export function measureForScore(raw: number, difficulties: readonly number[]): number | null {
  if (difficulties.length === 0) return null;
  if (raw <= 0 || raw >= difficulties.length) return null;

  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (expectedCorrect(mid, difficulties) < raw) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Ошибка оценки уровня: 1/√Σ P(1−P).
 *
 * Информация максимальна там, где задание для ученика 50 на 50, поэтому
 * точнее всего тест меряет тех, кому он впору, и хуже всего — тех, кто далеко
 * от его трудности. Без этого числа «+1.69» выглядит точнее, чем есть.
 */
export function standardError(measure: number, difficulties: readonly number[]): number {
  const information = difficulties.reduce((sum, b) => {
    const p = probability(measure, b);
    return sum + p * (1 - p);
  }, 0);
  return information > 0 ? 1 / Math.sqrt(information) : Number.POSITIVE_INFINITY;
}

/** Таблица «сумма верных → уровень» для одного варианта целиком. */
export function scoreTable(difficulties: readonly number[]): { raw: number; logit: number }[] {
  const rows: { raw: number; logit: number }[] = [];
  for (let raw = 1; raw < difficulties.length; raw += 1) {
    const measure = measureForScore(raw, difficulties);
    if (measure === null) continue;
    rows.push({ raw, logit: Math.round(measure * 100) / 100 });
  }
  return rows;
}

export type EquatingStatus =
  | "ok"
  /** У варианта нет ни одного задания, набравшего порог ответов. */
  | "not_calibrated"
  /** Вариант не связан с эталоном ни одним общим заданием — даже через цепочку. */
  | "not_linked"
  /** Ноль верных: уровень ниже того, что этот вариант способен измерить. */
  | "below_range"
  /** Все верные: уровень выше измеримого. */
  | "above_range";

export type EquatedResult = {
  status: EquatingStatus;
  /** Уровень подготовки в логитах общей шкалы банка. */
  measure: number | null;
  standard_error: number | null;
  /** Сколько заданий ученик решил бы на эталонном варианте. */
  equated_correct: number | null;
  /** Из скольких — длина эталонного варианта. */
  reference_length: number;
};

/**
 * Считает поправку для одной попытки.
 *
 * Оба набора трудностей приходят из одной калибровки, поэтому уже лежат на
 * одной шкале — связывание сделали общие задания. Проверка на связность здесь
 * не дублируется: её делает вызывающий, у которого есть карта вариантов.
 */
export function equateScore(params: {
  correct: number;
  variantDifficulties: readonly number[];
  referenceDifficulties: readonly number[];
  linked: boolean;
}): EquatedResult {
  const { correct, variantDifficulties, referenceDifficulties, linked } = params;
  const empty = {
    measure: null,
    standard_error: null,
    equated_correct: null,
    reference_length: referenceDifficulties.length,
  };

  if (variantDifficulties.length === 0 || referenceDifficulties.length === 0) {
    return { status: "not_calibrated", ...empty };
  }
  if (!linked) return { status: "not_linked", ...empty };

  const measure = measureForScore(correct, variantDifficulties);
  if (measure === null) {
    return { status: correct <= 0 ? "below_range" : "above_range", ...empty };
  }

  return {
    status: "ok",
    measure: Math.round(measure * 100) / 100,
    standard_error: Math.round(standardError(measure, variantDifficulties) * 100) / 100,
    equated_correct: Math.round(expectedCorrect(measure, referenceDifficulties) * 10) / 10,
    reference_length: referenceDifficulties.length,
  };
}
