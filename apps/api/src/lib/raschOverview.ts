/**
 * Сводка по всему банку в терминах модели Раша — то, что не помещается в
 * карточку одного задания, потому что относится к паре «банк и ученики».
 *
 * Карточка отвечает на вопрос «что не так с этим вопросом». Здесь вопросы
 * другие: попадает ли банк в тех, кто по нему учится; сколько уровней
 * подготовки шкала вообще различает; сравнимы ли между собой варианты.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./../db/client.js";
import {
  certCalibrationRuns,
  certExamItems,
  certExams,
  certItemCalibrations,
  certItems,
} from "../db/schema.js";
import { itemCode } from "./certExam.js";
import { collectResponses } from "./calibration.js";
import { scoreTable } from "./equating.js";
import { analyseDimensionality, SECOND_DIMENSION_THRESHOLD } from "./dimensionality.js";
import { loadEquatingContext } from "./equatingContext.js";
import {
  calibrate,
  calibrationState,
  fitBand,
  MIN_RESPONSES_PROVISIONAL,
  MIN_RESPONSES_STABLE,
  type CalibrationState,
  type FitBand,
} from "./rasch.js";

/** Шаг гистограммы карты Райта. Мельче — рябь, крупнее — теряется форма. */
const MAP_BIN = 0.25;

/** Шаг полосы в разборе покрытия: полулогита хватает, чтобы дыра была дырой. */
const BAND = 0.5;

/**
 * Ниже стольких учеников разделяющая способность не показывается.
 *
 * Формула посчитает её и на четверых, и число будет выглядеть как измерение —
 * а это разброс четырёх точек. Порог тот же, что у трудности задания: тридцать.
 */
const MIN_PERSONS_FOR_SEPARATION = 30;

export type OverviewItem = {
  id: number;
  code: string;
  task_number: number;
  difficulty: number;
  standard_error: number;
  infit: number;
  outfit: number;
  fit_band: FitBand;
  responses: number;
  state: CalibrationState;
  /**
   * Доля нынешних учеников, которая справляется с этим заданием по модели.
   * В отличие от сырой доли верных, считается против всех учеников банка, а
   * не только против тех, кому это задание досталось, — поэтому сравнима
   * между вариантами.
   */
  solved_share: number | null;
};

export type RaschOverview = {
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
  /** Подпись к оси: какую долю банка решает ученик такого уровня. */
  axis: { logit: number; share: number }[];
  bands: { from: number; persons: number; items: number; share: number }[];
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
  /** Вариант, к чьей шкале приводятся результаты остальных. */
  reference_exam_id: number | null;
  /**
   * Одномерность: меряет ли вариант одну величину. Считается по каждому
   * варианту отдельно — матрица остатков должна быть полной, а ученик пишет
   * один вариант, не весь банк.
   */
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
  }[];
  dimension_threshold: number;
  history: { run_id: number; run_at: string; persons: number; items: number }[];
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function histogram(values: number[], bin: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const v of values) {
    const key = Math.floor(v / bin) * bin;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/**
 * Сколько уровней подготовки шкала различает.
 *
 * Наблюдаемый разброс оценок складывается из настоящего разброса подготовки и
 * ошибки измерения; вычитая вторую, получаем первый. Отношение одного к другому
 * и есть индекс разделения G, а (4G+1)/3 — привычное «число страт»: сколько
 * статистически различимых групп получается из этих учеников этим тестом.
 */
function separation(abilities: number[], errors: number[]) {
  if (abilities.length < 2) return null;
  const m = mean(abilities);
  const observedVar = mean(abilities.map((a) => (a - m) ** 2));
  const mse = mean(errors.map((e) => e * e));
  const trueVar = Math.max(observedVar - mse, 0);
  if (mse <= 0) return null;
  const index = Math.sqrt(trueVar / mse);
  return {
    index,
    reliability: (index * index) / (1 + index * index),
    strata: (4 * index + 1) / 3,
  };
}

export async function buildOverview(teacherId: number): Promise<RaschOverview> {
  const thresholds = { provisional: MIN_RESPONSES_PROVISIONAL, stable: MIN_RESPONSES_STABLE };

  const runs = await db
    .select()
    .from(certCalibrationRuns)
    .where(eq(certCalibrationRuns.teacherId, teacherId))
    .orderBy(desc(certCalibrationRuns.runAt))
    .limit(10);

  const history = runs.map((r) => ({
    run_id: r.id,
    run_at: r.runAt.toISOString(),
    persons: r.persons,
    items: r.items,
  }));

  const empty: RaschOverview = {
    run: null,
    thresholds,
    map: { bin: MAP_BIN, rows: [], persons: 0, items: 0, person_mean: null, item_mean: null },
    axis: [],
    bands: [],
    separation: null,
    misfit: { underfit: [], overfit: [] },
    links: [],
    score_tables: [],
    reference_exam_id: null,
    dimensionality: [],
    dimension_threshold: SECOND_DIMENSION_THRESHOLD,
    history,
  };
  const latest = runs[0];
  if (!latest) return empty;

  const calibrations = await db
    .select()
    .from(certItemCalibrations)
    .where(eq(certItemCalibrations.runId, latest.id));
  if (calibrations.length === 0) return empty;

  const itemRows = await db
    .select({ id: certItems.id, taskNumber: certItems.taskNumber })
    .from(certItems)
    .where(
      and(
        eq(certItems.teacherId, teacherId),
        inArray(
          certItems.id,
          calibrations.map((c) => c.itemId),
        ),
      ),
    );
  const taskById = new Map(itemRows.map((r) => [r.id, r.taskNumber]));

  // Ниже порога число не показывается нигде в платформе — и здесь тоже, иначе
  // страница про качество измерения сама начнёт показывать шум.
  const shown: OverviewItem[] = calibrations
    .filter((c) => calibrationState(c.responses) !== "none")
    .map((c) => ({
      id: c.itemId,
      code: itemCode(c.itemId, taskById.get(c.itemId) ?? 0),
      task_number: taskById.get(c.itemId) ?? 0,
      difficulty: c.difficulty,
      standard_error: c.standardError,
      infit: c.infit,
      outfit: c.outfit,
      fit_band: fitBand(c.outfit),
      responses: c.responses,
      state: calibrationState(c.responses),
      solved_share: null,
    }))
    .sort((a, b) => a.difficulty - b.difficulty);

  // --- способности учеников ------------------------------------------
  // В базу они не ложатся: калибровка считает их и выбрасывает. Здесь они
  // нужны для карты, и считаются заново при зафиксированных трудностях —
  // задача одномерная и решается мгновенно.
  // Ни одно задание не набрало порога — значит показывать нечего, и карта из
  // одних учеников без заданий напротив них хуже пустого места: она выглядит
  // как измерение, которого не было.
  const runInfo = {
    run_id: latest.id,
    run_at: latest.runAt.toISOString(),
    persons: latest.persons,
    items: latest.items,
    converged: latest.converged,
  };
  if (shown.length === 0) return { ...empty, run: runInfo };

  const responses = await collectResponses(teacherId);
  const anchors = new Map(calibrations.map((c) => [c.itemId, c.difficulty]));
  const persons = responses.length > 0 ? calibrate(responses, { anchors }).persons : [];

  const abilities = persons.map((p) => p.ability);
  const itemDifficulties = shown.map((i) => i.difficulty);

  // --- вторая подпись к шкале ------------------------------------------
  // Логит честен, но непереводим на язык учителя. Доля решённого — переводима
  // и вычисляется из тех же трудностей: ожидаемое число верных при подготовке
  // θ есть сумма вероятностей по заданиям банка.
  //
  // Только как подпись, не как шкала: расстояние от 50% до 60% и от 85% до
  // 95% в процентах одинаково, а в подготовке — нет, поэтому средние и
  // приросты по процентам считать нельзя.
  const solveProbability = (ability: number, difficulty: number) =>
    1 / (1 + Math.exp(-(ability - difficulty)));
  const shareOfBank = (ability: number) =>
    itemDifficulties.length === 0
      ? 0
      : mean(itemDifficulties.map((b) => solveProbability(ability, b)));

  for (const item of shown) {
    item.solved_share = abilities.length
      ? mean(abilities.map((a) => solveProbability(a, item.difficulty)))
      : null;
  }

  const personHist = histogram(abilities, MAP_BIN);
  const itemHist = histogram(itemDifficulties, MAP_BIN);
  const keys = [...new Set([...personHist.keys(), ...itemHist.keys()])].sort((a, b) => a - b);
  const rows = keys.map((from) => ({
    from: Math.round(from * 100) / 100,
    persons: personHist.get(from) ?? 0,
    items: itemHist.get(from) ?? 0,
  }));

  const axis: { logit: number; share: number }[] = [];
  if (rows.length > 0) {
    const lo = Math.ceil(rows[0].from);
    const hi = Math.floor(rows[rows.length - 1].from);
    for (let l = lo; l <= hi; l += 1) axis.push({ logit: l, share: shareOfBank(l) });
  }

  // --- полосы покрытия -------------------------------------------------
  // Только там, где стоят ученики: пустая полоса выше всех учеников — не
  // дыра, а просто край шкалы.
  const bands: { from: number; persons: number; items: number; share: number }[] = [];
  if (abilities.length > 0) {
    const lo = Math.floor(Math.min(...abilities) / BAND) * BAND;
    const hi = Math.ceil(Math.max(...abilities) / BAND) * BAND;
    for (let from = lo; from < hi; from += BAND) {
      const to = from + BAND;
      bands.push({
        from: Math.round(from * 100) / 100,
        persons: abilities.filter((a) => a >= from && a < to).length,
        items: itemDifficulties.filter((d) => d >= from && d < to).length,
        // Доля банка, которую решает ученик из середины полосы.
        share: shareOfBank(from + BAND / 2),
      });
    }
  }

  // --- связанность вариантов -------------------------------------------
  const exams = await db
    .select({ id: certExams.id, title: certExams.title })
    .from(certExams)
    .where(eq(certExams.teacherId, teacherId));
  const examItems = await db
    .select({ examId: certExamItems.examId, itemId: certExamItems.itemId })
    .from(certExamItems)
    .innerJoin(certExams, eq(certExams.id, certExamItems.examId))
    .where(eq(certExams.teacherId, teacherId));

  const itemsByExam = new Map<number, Set<number>>();
  for (const r of examItems) {
    const set = itemsByExam.get(r.examId) ?? new Set<number>();
    set.add(r.itemId);
    itemsByExam.set(r.examId, set);
  }
  const calibratedIds = new Set(shown.map((i) => i.id));

  const links = exams.map((e) => {
    const own = itemsByExam.get(e.id) ?? new Set<number>();
    return {
      exam_id: e.id,
      title: e.title,
      items: own.size,
      calibrated: [...own].filter((id) => calibratedIds.has(id)).length,
      partners: exams
        .filter((o) => o.id !== e.id)
        .map((o) => {
          const other = itemsByExam.get(o.id) ?? new Set<number>();
          return {
            exam_id: o.id,
            title: o.title,
            shared: [...own].filter((id) => other.has(id)).length,
          };
        })
        .filter((p) => p.shared > 0),
    };
  });

  // --- таблицы перевода -------------------------------------------------
  const difficultyById = new Map(shown.map((i) => [i.id, i.difficulty]));
  const score_tables = exams
    .map((e) => {
      const own = [...(itemsByExam.get(e.id) ?? new Set<number>())]
        .map((id) => difficultyById.get(id))
        .filter((b): b is number => b !== undefined);
      return { exam_id: e.id, title: e.title, items: own.length, rows: scoreTable(own) };
    })
    .filter((t) => t.items >= 5);

  // --- одномерность по вариантам ---------------------------------------
  const abilityById = new Map(persons.map((p) => [p.personId, p.ability]));
  const difficultyByItem = new Map(shown.map((i) => [i.id, i.difficulty]));
  const codeByItem = new Map(shown.map((i) => [i.id, i.code]));
  const responsesByExam = new Map<number, typeof responses>();
  for (const r of responses) {
    for (const [examId, items] of itemsByExam) {
      if (!items.has(r.itemId)) continue;
      const list = responsesByExam.get(examId) ?? [];
      list.push(r);
      responsesByExam.set(examId, list);
    }
  }

  const dimensionality: RaschOverview["dimensionality"] = [];
  for (const exam of exams) {
    const rows = responsesByExam.get(exam.id);
    if (!rows) continue;
    const analysis = analyseDimensionality({
      responses: rows,
      difficulties: difficultyByItem,
      abilities: abilityById,
    });
    if (!analysis) continue;
    const named = analysis.loadings.map((l) => ({
      code: codeByItem.get(l.itemId) ?? String(l.itemId),
      loading: l.loading,
    }));
    dimensionality.push({
      exam_id: exam.id,
      title: exam.title,
      items: analysis.items,
      persons: analysis.persons,
      first_contrast: analysis.firstContrast,
      noise_ceiling: analysis.noiseCeiling,
      suspect: analysis.suspect,
      top: named.slice(0, 5),
      bottom: named.slice(-5).reverse(),
    });
  }

  return {
    run: runInfo,
    thresholds,
    map: {
      bin: MAP_BIN,
      rows,
      persons: abilities.length,
      items: shown.length,
      person_mean: abilities.length ? mean(abilities) : null,
      item_mean: shown.length ? mean(itemDifficulties) : null,
    },
    axis,
    bands,
    separation:
      abilities.length >= MIN_PERSONS_FOR_SEPARATION
        ? separation(
            abilities,
            persons.map((p) => p.standardError),
          )
        : null,
    misfit: {
      underfit: shown.filter((i) => i.outfit > 1.5).sort((a, b) => b.outfit - a.outfit),
      overfit: shown.filter((i) => i.outfit < 0.5).sort((a, b) => a.outfit - b.outfit),
    },
    links,
    score_tables,
    reference_exam_id: (await loadEquatingContext(teacherId)).referenceExamId,
    dimensionality,
    dimension_threshold: SECOND_DIMENSION_THRESHOLD,
    history,
  };
}
