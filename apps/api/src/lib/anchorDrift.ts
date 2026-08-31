/**
 * Дрейф якорей: не изменилось ли общее задание между вариантами.
 *
 * Связность отвечает на вопрос «лежат ли варианты на одной шкале». Этот
 * модуль — на следующий: «а честно ли лежат». Шкалу держат общие задания, и
 * держат они её ровно до тех пор, пока остаются одним и тем же вопросом. Если
 * задание утекло в чаты, или тему стали проходить иначе, оно ведёт себя в
 * новом варианте не так, как в старом, — и тянет за собой всю связь. Со
 * стороны это выглядит как сдвиг всей шкалы, а не как поломка одного вопроса.
 *
 * Метод. Каждый вариант калибруется отдельно, поэтому у каждого своё начало
 * отсчёта. Сначала начала совмещаются: сдвиг — среднее расхождение по всем
 * общим заданиям. Остаток после совмещения и есть дрейф конкретного задания:
 * насколько оно выбивается из общей картины, когда общая картина уже учтена.
 *
 * Порог. Каноническое «больше половины логита» выведено для больших когорт.
 * На сотне учеников SE самого задания около 0.2, и половина логита — это два
 * с половиной стандартных отклонения; на потоке поменьше та же константа
 * превращается в генератор ложных тревог. Поэтому флаг требует ОБОИХ условий:
 * содержательного размера и статистической значимости.
 */

export type AnchorMeasure = {
  itemId: number;
  difficulty: number;
  standardError: number;
};

export type AnchorDrift = {
  itemId: number;
  /** Расхождение после совмещения шкал, в логитах. */
  drift: number;
  /** Ошибка самого расхождения: √(SE₁² + SE₂²). */
  standardError: number;
  /** Во сколько стандартных ошибок укладывается расхождение. */
  z: number;
  drifted: boolean;
};

/** Ниже этого расхождение не считается содержательным, какой бы ни была значимость. */
export const DRIFT_MIN_LOGITS = 0.5;

/** И ниже этого — не считается значимым, каким бы ни был размер. */
export const DRIFT_MIN_Z = 2;

/**
 * Сколько устойчивых общих заданий должно остаться, чтобы связь считалась
 * надёжной. Ниже — удаление ещё одного двигает шкалу сильнее, чем сам дрейф,
 * и связывать становится не на чем.
 */
export const MIN_STABLE_ANCHORS = 3;

export function compareAnchors(
  first: readonly AnchorMeasure[],
  second: readonly AnchorMeasure[],
): { shift: number; drifts: AnchorDrift[] } {
  const secondById = new Map(second.map((m) => [m.itemId, m]));
  const pairs = first
    .map((a) => ({ a, b: secondById.get(a.itemId) }))
    .filter((p): p is { a: AnchorMeasure; b: AnchorMeasure } => p.b !== undefined);

  if (pairs.length === 0) return { shift: 0, drifts: [] };

  const shift = pairs.reduce((sum, p) => sum + (p.a.difficulty - p.b.difficulty), 0) / pairs.length;

  const drifts = pairs.map(({ a, b }) => {
    const drift = a.difficulty - (b.difficulty + shift);
    const standardError = Math.sqrt(a.standardError ** 2 + b.standardError ** 2);
    const z = standardError > 0 ? drift / standardError : 0;
    return {
      itemId: a.itemId,
      drift: Math.round(drift * 1000) / 1000,
      standardError: Math.round(standardError * 1000) / 1000,
      z: Math.round(z * 100) / 100,
      drifted: Math.abs(drift) >= DRIFT_MIN_LOGITS && Math.abs(z) >= DRIFT_MIN_Z,
    };
  });

  return { shift: Math.round(shift * 1000) / 1000, drifts };
}
