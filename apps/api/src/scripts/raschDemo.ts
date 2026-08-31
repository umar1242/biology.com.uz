/**
 * Демонстрация модели Раша на синтетических данных.
 *
 * Заводит ОТДЕЛЬНОГО учителя со своим курсом, двумя вариантами и двумя
 * когортами по 60 участников. Отдельного — потому что калибровка сводит все
 * ответы одного учителя в одну матрицу: подмешать сюда настоящий банк значило
 * бы испортить его статистику синтетикой. Всё разделено по teacher_id, боевые
 * данные скрипт не читает и не трогает.
 *
 *   RASCH_DEMO=yes DEMO_PASSWORD=... npm run demo:rasch --workspace=apps/api
 *   RASCH_DEMO=yes DEMO_PASSWORD=... npm run demo:rasch --workspace=apps/api -- password
 *   RASCH_DEMO=yes npm run demo:rasch --workspace=apps/api -- purge
 *
 * Смысл демонстрации — показать то, ради чего в банке заведены якорные
 * задания. Вариант B сделан объективно труднее варианта A, но и когорта B
 * сильнее. Доля верных ответов эти два факта не различает: она меряет
 * задание вместе с теми, кто его решал. Модель Раша через восемь общих
 * заданий кладёт оба варианта на одну шкалу и разводит трудность и
 * способность обратно.
 *
 * Данные детерминированы: один и тот же посев ГСЧ даёт те же числа, поэтому
 * отчёт воспроизводим и его можно сверять после правок в lib/rasch.ts.
 */
import { eq, sql } from "drizzle-orm";
import { db, queryClient } from "../db/client.js";
import {
  certExamAnswers,
  certExamAttempts,
  certExamItems,
  certExams,
  certItems,
  courseAccess,
  courses,
  staffUsers,
  students,
  teachers,
} from "../db/schema.js";
import { hashPassword } from "../auth/password.js";
import { isClosedTask, itemCode, maxPointsFor, optionsFor, topicFor } from "../lib/certExam.js";
import { calibrate, type RaschResponse } from "../lib/rasch.js";
import { categoryProbabilities, PCM_CATEGORY_COUNT } from "../lib/pcm.js";
import {
  latestCalibrationByItem,
  runCalibration,
  type ItemCalibration,
} from "../lib/calibration.js";

const USERNAME = "demo_rasch";
const DISPLAY_NAME = "Демо: модель Раша";
const COURSE_TITLE = "Демо-курс: калибровка банка";

/**
 * Идентификаторы вне пространства Telegram (сейчас там ~10^10). Ни один
 * настоящий человек такой id иметь не может, поэтому даже случайная попытка
 * что-то отправить этим «ученикам» ни до кого не дойдёт.
 */
const TELEGRAM_BASE = 9_000_000_000_000;

const COHORT_SIZE = 60;

/** Задания, которые стоят в обоих вариантах, — те самые якоря. */
const ANCHOR_TASKS = [4, 9, 14, 19, 24, 29, 33, 38];

/**
 * Один якорь «утёк»: когорта B решает его так, будто знала ответ заранее.
 * Задание то же, вопрос тот же — а ведёт себя в двух вариантах по-разному,
 * и связь, на нём построенная, кривая. Именно это должна поймать диагностика
 * дрейфа, и без такого задания в данных она проверяется только на бумаге.
 *
 * Взято трудное задание, и не только для реализма (лёгкие никто не сливает).
 * Утечка на лёгком уводит его почти в потолок: девять из десяти верных, из
 * четырёх оставшихся ошибок трудность уже не оценить, и наблюдаемый дрейф
 * сжимается вдвое против настоящего. Первым заходом якорь стоял на задании
 * 19, дал 0.85 при z = 1.63 и до флага не дотянул — при истинной утечке 1.6.
 */
const LEAKED_ANCHOR_TASK = 33;

/** Насколько легче стал утёкший якорь для второй когорты, в логитах. */
const LEAK_SIZE = 1.6;

/**
 * Одно намеренно испорченное задание в варианте B: в ключе стоит не та буква.
 * Самый частый настоящий дефект — и тот, который в банке ловят сразу три
 * независимых признака: чип «Проверьте ключ», отрицательная дискриминация и
 * outfit. Подготовленные ученики выбирают верную по смыслу букву и получают
 * ноль; неподготовленные тычут наугад и иногда попадают в ту, что записана.
 */
const BROKEN_TASK = 21;

/** Насколько вариант B труднее варианта A, в логитах. */
const VARIANT_B_SHIFT = 0.5;

/** Насколько когорта B сильнее когорты A, в логитах. */
const COHORT_B_SHIFT = 0.9;

/**
 * Третий вариант заводится нарочно неправильно: ни одного общего задания с
 * A и B и ни одного общего ученика. Он существует, чтобы показать, что
 * платформа делает с таким вариантом — а делает она единственно верное:
 * не считает его вовсе, вместо того чтобы выдать числа на собственной шкале,
 * неотличимые с виду от остальных.
 */
const ORPHAN_COHORT_SIZE = 30;

/** Только задания 1–40 дихотомичны; 41–43 оцениваются в баллах и в
 *  дихотомическую модель не входят (см. lib/calibration.ts). */
const SCORED_TASKS = Array.from({ length: 40 }, (_, i) => i + 1);

// --- ГСЧ ---------------------------------------------------------------
// Свой, а не Math.random: демонстрация обязана быть воспроизводимой.

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand = mulberry32(20260830);

function normal(mean: number, sd: number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function probability(ability: number, difficulty: number): number {
  return 1 / (1 + Math.exp(-(ability - difficulty)));
}

/**
 * Истинная трудность задания. Внутри варианта она нарастает от −2.2 к +2.2:
 * так устроен и настоящий Milliy Sertifikat, где первые задания проходные, а
 * последние отсеивают.
 */
function trueDifficulty(task: number, shift: number): number {
  const t = (task - 1) / 39;
  return -2.2 + 4.4 * t + shift + (rand() - 0.5) * 0.5;
}

/**
 * Пороги ступеней письменной работы вокруг её трудности: перейти на первую
 * ступень легче, чем на последнюю, и расстояние между ними примерно логит.
 */
function writtenThresholds(difficulty: number): number[] {
  const steps = PCM_CATEGORY_COUNT - 1;
  return Array.from(
    { length: steps },
    (_, i) => difficulty + (i - (steps - 1) / 2) * 0.9,
  );
}

function keyFor(task: number): string | null {
  const options = optionsFor(task);
  if (options.length === 0) return null;
  return options[Math.floor(rand() * options.length)];
}

function wrongOption(task: number, key: string): string {
  const options = optionsFor(task).filter((o) => o !== key);
  return options[Math.floor(rand() * options.length)];
}

// --- удаление ----------------------------------------------------------

async function findTenant(): Promise<{ staffId: number } | null> {
  const [row] = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(eq(staffUsers.username, USERNAME))
    .limit(1);
  return row ? { staffId: row.id } : null;
}

async function purge(): Promise<void> {
  const tenant = await findTenant();
  if (!tenant) {
    console.log("Демо-арендатора нет — удалять нечего.");
    return;
  }
  const t = tenant.staffId;

  // Порядок — по внешним ключам. Ответы уходят каскадом за попытками, но
  // удаляются явно: каскад легко потерять при правке схемы.
  await db.execute(sql`DELETE FROM cert_exam_answers WHERE attempt_id IN
    (SELECT id FROM cert_exam_attempts WHERE teacher_id = ${t})`);
  await db.execute(sql`DELETE FROM cert_exam_attempts WHERE teacher_id = ${t}`);
  await db.execute(sql`DELETE FROM cert_item_calibrations WHERE run_id IN
    (SELECT id FROM cert_calibration_runs WHERE teacher_id = ${t})`);
  await db.execute(sql`DELETE FROM cert_calibration_runs WHERE teacher_id = ${t}`);
  await db.execute(sql`DELETE FROM cert_exam_items WHERE exam_id IN
    (SELECT id FROM cert_exams WHERE teacher_id = ${t})`);
  await db.execute(sql`DELETE FROM cert_exams WHERE teacher_id = ${t}`);
  await db.execute(sql`DELETE FROM cert_item_answer_keys WHERE item_id IN
    (SELECT id FROM cert_items WHERE teacher_id = ${t})`);
  await db.execute(sql`DELETE FROM cert_items WHERE teacher_id = ${t}`);
  await db.execute(sql`DELETE FROM course_access WHERE teacher_id = ${t}`);
  await db.execute(sql`DELETE FROM courses WHERE teacher_id = ${t}`);
  await db.execute(sql`DELETE FROM students WHERE telegram_id >= ${TELEGRAM_BASE}`);
  await db.execute(sql`DELETE FROM teachers WHERE staff_user_id = ${t}`);
  await db.execute(sql`DELETE FROM staff_users WHERE id = ${t}`);
  console.log("Демо-арендатор удалён полностью.");
}

// --- посев -------------------------------------------------------------

type Variant = "A" | "B" | "C";

type SeededItem = {
  id: number;
  task: number;
  key: string | null;
  trueDifficulty: number;
  variant: Variant;
  broken: boolean;
  /** Только у испорченного задания: буква, верная по смыслу, но не та, что в ключе. */
  truthOption?: string;
};

async function seed(): Promise<void> {
  const password = process.env.DEMO_PASSWORD ?? "";
  if (password.length < 10) {
    console.error(
      "Нужен DEMO_PASSWORD длиной не меньше 10 символов: панель открыта наружу,\n" +
        "и демо-учитель с коротким паролем — это дверь, а не демонстрация.",
    );
    process.exit(1);
  }

  await purge();
  rand = mulberry32(20260830);

  const passwordHash = await hashPassword(password);
  const [staff] = await db
    .insert(staffUsers)
    .values({ username: USERNAME, role: "teacher", passwordHash, displayName: DISPLAY_NAME })
    .returning({ id: staffUsers.id });
  await db.insert(teachers).values({ staffUserId: staff.id });
  const teacherId = staff.id;

  const [course] = await db
    .insert(courses)
    .values({
      teacherId,
      title: COURSE_TITLE,
      subject: "biology",
      description: "Синтетические данные для демонстрации калибровки. Не реальные ученики.",
    })
    .returning({ id: courses.id });

  const past = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const examRows = await db
    .insert(certExams)
    .values([
      {
        courseId: course.id,
        teacherId,
        title: "Демо-вариант A",
        deadlineAt: past,
        publishedAt: past,
      },
      {
        courseId: course.id,
        teacherId,
        title: "Демо-вариант B (труднее)",
        deadlineAt: past,
        publishedAt: past,
      },
      {
        courseId: course.id,
        teacherId,
        title: "Демо-вариант C (без якорей)",
        deadlineAt: past,
        publishedAt: past,
      },
    ])
    .returning({ id: certExams.id, title: certExams.title });
  const examA = examRows[0].id;
  const examB = examRows[1].id;
  const examC = examRows[2].id;

  // --- задания -------------------------------------------------------
  const items: SeededItem[] = [];

  const makeItems = async (variant: Variant, tasks: number[], shift: number) => {
    const values = tasks.map((task) => {
      const b = trueDifficulty(task, shift);
      const key = keyFor(task);
      return {
        row: {
          teacherId,
          taskNumber: task,
          correctOption: key,
          topic: topicFor(task),
          sourceRef: `Демо · вариант ${variant} · №${task}`,
          notes:
            variant === "B" && task === BROKEN_TASK
              ? "Симуляция: в ключе намеренно стоит не та буква."
              : `Симуляция: истинная трудность ${b.toFixed(2)} логита.`,
          createdBy: staff.id,
        },
        task,
        key,
        b,
      };
    });
    const inserted = await db
      .insert(certItems)
      .values(values.map((v) => v.row))
      .returning({ id: certItems.id, taskNumber: certItems.taskNumber });
    // returning() сохраняет порядок values, но полагаться на это не стоит:
    // сопоставляем по номеру задания, он внутри варианта уникален.
    for (const v of values) {
      const row = inserted.find((r) => r.taskNumber === v.task);
      if (!row) throw new Error(`Не вернулась строка для задания ${v.task}`);
      const broken = variant === "B" && v.task === BROKEN_TASK;
      items.push({
        id: row.id,
        task: v.task,
        key: v.key,
        trueDifficulty: v.b,
        variant,
        broken,
        truthOption: broken && v.key ? wrongOption(v.task, v.key) : undefined,
      });
    }
  };

  const allTasks = Array.from({ length: 43 }, (_, i) => i + 1);
  await makeItems("A", allTasks, 0);
  await makeItems(
    "B",
    allTasks.filter((t) => !ANCHOR_TASKS.includes(t)),
    VARIANT_B_SHIFT,
  );
  // У C свои задания на все 43 позиции: ни одного общего с A и B.
  await makeItems("C", allTasks, 0.2);

  const byVariantTask = new Map<string, SeededItem>();
  for (const i of items) byVariantTask.set(`${i.variant}:${i.task}`, i);

  const itemsOf = (variant: Variant) =>
    allTasks.map((task) => {
      const own = byVariantTask.get(`${variant}:${task}`);
      if (own) return own;
      const anchor = byVariantTask.get(`A:${task}`);
      if (!anchor) throw new Error(`Нет задания для ${variant}/${task}`);
      return anchor;
    });

  const examItems = [
    ...itemsOf("A").map((i) => ({ examId: examA, taskNumber: i.task, itemId: i.id })),
    ...itemsOf("B").map((i) => ({ examId: examB, taskNumber: i.task, itemId: i.id })),
    ...itemsOf("C").map((i) => ({ examId: examC, taskNumber: i.task, itemId: i.id })),
  ];
  await db.insert(certExamItems).values(examItems);

  // --- участники и ответы --------------------------------------------
  const matrixA: RaschResponse[] = [];
  const matrixB: RaschResponse[] = [];

  let telegramId = TELEGRAM_BASE;
  const abilities: { variant: Variant; ability: number }[] = [];

  for (const [variant, examId, abilityShift, size] of [
    ["A", examA, 0, COHORT_SIZE],
    ["B", examB, COHORT_B_SHIFT, COHORT_SIZE],
    ["C", examC, 0.3, ORPHAN_COHORT_SIZE],
  ] as const) {
    const sheet = itemsOf(variant);
    const studentValues = Array.from({ length: size }, (_, i) => ({
      telegramId: telegramId++,
      firstName: `Демо ${variant}${String(i + 1).padStart(2, "0")}`,
      lastName: "(симуляция)",
    }));
    const studentRows = await db
      .insert(students)
      .values(studentValues)
      .returning({ id: students.id });

    await db.insert(courseAccess).values(
      studentRows.map((s) => ({
        courseId: course.id,
        studentId: s.id,
        teacherId,
        accessGranted: true,
        grantedAt: past,
        grantedBy: staff.id,
        // Дата заведомо далёкая: пробный период выключен, а срок доступа не
        // должен разбудить ни одну из фоновых задач.
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        isTrial: false,
      })),
    );

    for (const s of studentRows) {
      const ability = normal(abilityShift, 1.05);
      abilities.push({ variant, ability });

      // Задания 33–35 по спецификации сидят на общем тексте: понял текст —
      // решил все три, не понял — провалил все три, и подготовка тут ни при
      // чём. Эта прибавка и создаёт зависимость, которую должен найти Q₃.
      const reading = normal(0, 1.6);

      const answers: (typeof certExamAnswers.$inferInsert)[] = [];
      let auto = 0;
      let manual = 0;

      for (const item of sheet) {
        const task = item.task;
        if (task > 40) {
          // Развёрнутые работы порождаются частично-кредитной моделью — той
          // самой, которой они потом и калибруются. Раньше баллы были
          // детерминированной функцией подготовки, и соответствие выходило
          // 0.40: «слишком предсказуемо». Это было свойство генератора, а не
          // заданий, и демонстрация на нём врала.
          const thresholds = writtenThresholds(item.trueDifficulty);
          const probabilities = categoryProbabilities(ability, thresholds);
          let roll = rand();
          let category = 0;
          for (let k = 0; k < probabilities.length; k += 1) {
            roll -= probabilities[k];
            if (roll <= 0) {
              category = k;
              break;
            }
          }
          const points = Math.round(
            (maxPointsFor(task) * category) / (PCM_CATEGORY_COUNT - 1),
          );
          manual += points;
          answers.push({ attemptId: 0, taskNumber: task, itemId: item.id, awardedPoints: points });
          continue;
        }

        const leaked = variant === "B" && item.task === LEAKED_ANCHOR_TASK;
        const sharedText = task >= 33 && task <= 35 ? reading : 0;
        const knows =
          rand() <
          probability(ability + sharedText, item.trueDifficulty - (leaked ? LEAK_SIZE : 0));
        // Вариант C в разборы якорей не идёт: он существует ради проверки
        // связности, и подмешивать его в сравнение A с B нельзя.
        const matrix = variant === "A" ? matrixA : variant === "B" ? matrixB : null;

        if (isClosedTask(task)) {
          const key = item.key as string;
          // При опечатке в ключе знание ведёт мимо: тот, кто понял задание,
          // выбирает букву, верную по смыслу, а она в ключе не записана.
          const chosen = item.broken
            ? knows
              ? (item.truthOption as string)
              : optionsFor(task)[Math.floor(rand() * optionsFor(task).length)]
            : knows
              ? key
              : wrongOption(task, key);
          const correct = chosen === key;
          if (correct) auto += 1;
          answers.push({
            attemptId: 0,
            taskNumber: task,
            itemId: item.id,
            chosenOption: chosen,
            isCorrect: correct,
          });
          matrix?.push({ personId: s.id, itemId: item.id, correct });
          continue;
        }
        {
          const correct = knows;
          const points = correct ? maxPointsFor(task) : 0;
          manual += points;
          answers.push({ attemptId: 0, taskNumber: task, itemId: item.id, awardedPoints: points });
          matrix?.push({ personId: s.id, itemId: item.id, correct });
        }
      }

      const [attempt] = await db
        .insert(certExamAttempts)
        .values({
          examId,
          studentId: s.id,
          teacherId,
          attemptNumber: 1,
          status: "reviewed",
          startedAt: past,
          submittedAt: past,
          isLate: false,
          autoScore: auto,
          manualScore: manual,
          totalScore: auto + manual,
          reviewedBy: staff.id,
          reviewedAt: past,
        })
        .returning({ id: certExamAttempts.id });

      await db.insert(certExamAnswers).values(answers.map((a) => ({ ...a, attemptId: attempt.id })));
    }
  }

  console.log(
    `Заведено: учитель #${teacherId}, курс #${course.id}, три варианта, ` +
      `${items.length} заданий в банке, ${COHORT_SIZE * 2 + ORPHAN_COHORT_SIZE} участников.`,
  );

  await report({ teacherId, items, matrixA, matrixB, abilities });
}

// --- отчёт -------------------------------------------------------------

function fmt(n: number, width = 6, digits = 2): string {
  return n.toFixed(digits).padStart(width);
}

function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

function rmse(xs: number[], ys: number[]): number {
  const n = xs.length;
  let s = 0;
  for (let i = 0; i < n; i += 1) s += (xs[i] - ys[i]) ** 2;
  return Math.sqrt(s / n);
}

async function report(ctx: {
  teacherId: number;
  items: SeededItem[];
  matrixA: RaschResponse[];
  matrixB: RaschResponse[];
  abilities: { variant: Variant; ability: number }[];
}): Promise<void> {
  const { teacherId, items, matrixA, matrixB, abilities } = ctx;
  const byId = new Map(items.map((i) => [i.id, i]));

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const abilityA = mean(abilities.filter((a) => a.variant === "A").map((a) => a.ability));
  const abilityB = mean(abilities.filter((a) => a.variant === "B").map((a) => a.ability));

  console.log("\n=== 1. ЧТО СГЕНЕРИРОВАНО =========================================");
  console.log(
    `Вариант A: 43 задания, когорта ${COHORT_SIZE} человек, средняя способность ${abilityA.toFixed(2)} логита.`,
  );
  console.log(
    `Вариант B: 43 задания (из них ${ANCHOR_TASKS.length} якорных общих с A), когорта ${COHORT_SIZE} человек,`,
  );
  console.log(`           средняя способность ${abilityB.toFixed(2)} логита.`);
  console.log(
    `Задания варианта B труднее на ${VARIANT_B_SHIFT.toFixed(2)} логита по построению; когорта B сильнее на ${COHORT_B_SHIFT.toFixed(2)}.`,
  );

  // --- наивный взгляд -------------------------------------------------
  const shareCorrect = (matrix: RaschResponse[], variant: Variant) => {
    const rows = matrix.filter((r) => {
      const item = byId.get(r.itemId);
      return item && (item.variant === variant || ANCHOR_TASKS.includes(item.task));
    });
    return rows.filter((r) => r.correct).length / rows.length;
  };
  const ownItems = (variant: Variant) => items.filter((i) => i.variant === variant);

  console.log("\n=== 2. НАИВНЫЙ ВЗГЛЯД: ДОЛЯ ВЕРНЫХ ===============================");
  console.log(
    `Вариант A: ${(shareCorrect(matrixA, "A") * 100).toFixed(1)}% верных, средняя истинная трудность заданий ${mean(
      ownItems("A").filter((i) => i.task <= 40).map((i) => i.trueDifficulty),
    ).toFixed(2)}`,
  );
  console.log(
    `Вариант B: ${(shareCorrect(matrixB, "B") * 100).toFixed(1)}% верных, средняя истинная трудность заданий ${mean(
      ownItems("B").filter((i) => i.task <= 40).map((i) => i.trueDifficulty),
    ).toFixed(2)}`,
  );
  console.log(
    "Доли близки, хотя вариант B объективно труднее: сильная когорта вытянула его наверх.",
  );
  console.log("Сравнивать задания по доле верных между вариантами нельзя — это и есть проблема.");

  // --- боевая калибровка ---------------------------------------------
  console.log("\n=== 3. КАЛИБРОВКА (боевой путь, оба варианта в одной матрице) ====");
  const run = await runCalibration(teacherId);
  console.log(
    `Прогон #${run.run_id}: участников ${run.persons}, заданий ${run.items}, итераций ${run.iterations}, ` +
      `сошлось: ${run.converged ? "да" : "нет"}, ответов на входе ${run.responses}.`,
  );
  if (run.excluded_items || run.excluded_persons) {
    console.log(
      `Отсеяно как экстремальные: заданий ${run.excluded_items}, участников ${run.excluded_persons}.`,
    );
  }

  const stored = await latestCalibrationByItem(teacherId);
  const pairs: { item: SeededItem; c: ItemCalibration }[] = [];
  for (const [id, c] of stored) {
    const item = byId.get(id);
    if (item) pairs.push({ item, c });
  }
  const honest = pairs.filter((p) => !p.item.broken);
  console.log(
    `Восстановленная трудность против истинной по ${honest.length} заданиям: ` +
      `корреляция ${correlation(
        honest.map((p) => p.item.trueDifficulty),
        honest.map((p) => p.c.difficulty),
      ).toFixed(3)}, RMSE ${rmse(
        honest.map((p) => p.item.trueDifficulty),
        honest.map((p) => p.c.difficulty),
      ).toFixed(3)} логита.`,
  );

  console.log("\nПервые двенадцать заданий варианта A:");
  console.log("  код        истина  оценка      SE   infit  outfit  ответов");
  for (const p of pairs
    .filter((p) => p.item.variant === "A" && p.item.task <= 12)
    .sort((a, b) => a.item.task - b.item.task)) {
    console.log(
      `  ${itemCode(p.item.id, p.item.task).padEnd(10)} ${fmt(p.item.trueDifficulty)} ${fmt(
        p.c.difficulty,
      )} ${fmt(p.c.standard_error, 7)} ${fmt(p.c.infit)} ${fmt(p.c.outfit, 7)} ${String(
        p.c.responses,
      ).padStart(8)}`,
    );
  }

  // --- испорченное задание -------------------------------------------
  const brokenPair = pairs.find((p) => p.item.broken);
  console.log("\n=== 4. ИСПОРЧЕННОЕ ЗАДАНИЕ =======================================");
  if (brokenPair) {
    const others = honest.map((p) => p.c.outfit).sort((a, b) => a - b);
    console.log(
      `Задание ${itemCode(brokenPair.item.id, brokenPair.item.task)} (вариант B, №${brokenPair.item.task}): ` +
        `в ключе стоит не та буква.`,
    );
    console.log(
      `  outfit ${brokenPair.c.outfit.toFixed(2)}, infit ${brokenPair.c.infit.toFixed(2)} ` +
        `при медиане outfit по остальным ${others[Math.floor(others.length / 2)].toFixed(2)}.`,
    );
    console.log(
      `  Выше 1.5 — «задание ведёт себя непредсказуемо»: подготовленные ученики его проваливают.`,
    );
    console.log(
      `  В банке это же задание помечено чипом «Проверьте ключ», а дискриминация у него ушла`,
    );
    console.log(`  в минус: три независимых признака указывают на один и тот же дефект.`);
  }

  // --- якоря ----------------------------------------------------------
  console.log("\n=== 5. РАДИ ЧЕГО ЯКОРЯ ===========================================");
  const soloA = calibrate(matrixA);
  const soloB = calibrate(matrixB);
  const anchorIds = items.filter((i) => i.variant === "A" && ANCHOR_TASKS.includes(i.task));

  const soloAById = new Map(soloA.items.map((i) => [i.itemId, i]));
  const soloBById = new Map(soloB.items.map((i) => [i.itemId, i]));

  console.log("Восемь общих заданий, посчитанных в каждом варианте отдельно:");
  console.log("  код        истина   в A     в B   разница");
  const shifts: number[] = [];
  for (const a of anchorIds) {
    const inA = soloAById.get(a.id);
    const inB = soloBById.get(a.id);
    if (!inA || !inB) continue;
    shifts.push(inB.difficulty - inA.difficulty);
    console.log(
      `  ${itemCode(a.id, a.task).padEnd(10)} ${fmt(a.trueDifficulty)} ${fmt(inA.difficulty)} ${fmt(
        inB.difficulty,
      )} ${fmt(inB.difficulty - inA.difficulty, 9)}`,
    );
  }
  const meanShift = mean(shifts);
  console.log(
    `\nОдно и то же задание в двух вариантах получило оценки, расходящиеся в среднем на ${meanShift.toFixed(
      2,
    )} логита.`,
  );
  console.log(
    "Задание не менялось. Каждая калибровка сама назначает начало отсчёта: трудности её",
  );
  console.log(
    "собственных заданий центрируются на нуле. Вариант B труднее, значит его ноль стоит выше —",
  );
  console.log("и всё в нём, включая общие задания, съезжает вниз ровно на эту разницу наборов.");

  const anchors = new Map<number, number>();
  for (const a of anchorIds) {
    const inA = soloAById.get(a.id);
    if (inA) anchors.set(a.id, inA.difficulty);
  }
  const linkedB = calibrate(matrixB, { anchors });
  const linkedById = new Map(linkedB.items.map((i) => [i.itemId, i]));

  const ownB = items.filter((i) => i.variant === "B" && i.task <= 40 && !i.broken);
  const trueB = ownB.map((i) => i.trueDifficulty);
  const unlinked = ownB.map((i) => soloBById.get(i.id)?.difficulty ?? 0);
  const linked = ownB.map((i) => linkedById.get(i.id)?.difficulty ?? 0);

  console.log("\nСобственные задания варианта B против истины:");
  console.log(
    `  без якорей:  сдвиг ${(mean(unlinked) - mean(trueB)).toFixed(2)}, RMSE ${rmse(trueB, unlinked).toFixed(3)}`,
  );
  console.log(
    `  с якорями:   сдвиг ${(mean(linked) - mean(trueB)).toFixed(2)}, RMSE ${rmse(trueB, linked).toFixed(3)}`,
  );
  const abilityOf = (result: ReturnType<typeof calibrate>) =>
    mean(result.persons.map((p) => p.ability));
  console.log("\nВторая половина той же картины — способность когорты B:");
  console.log(`  истинная (по построению):     ${COHORT_B_SHIFT.toFixed(2)}`);
  console.log(`  без якорей, на своей шкале:   ${abilityOf(soloB).toFixed(2)}`);
  console.log(`  с якорями, на шкале банка:    ${abilityOf(linkedB).toFixed(2)}`);
  console.log(
    "Без связывания сильная когорта на трудном варианте выглядит средней: сдвиг ушёл в шкалу.",
  );

  const seOf = (list: { item: SeededItem; c: ItemCalibration }[]) =>
    mean(list.map((p) => p.c.standard_error));
  const anchorSet = new Set(anchorIds.map((a) => a.id));
  const anchorPairs = pairs.filter((p) => anchorSet.has(p.item.id));
  const singlePairs = pairs.filter((p) => !anchorSet.has(p.item.id));
  console.log("\nПобочная выгода: якорь отвечали обе когорты, поэтому он измерен точнее.");
  console.log(
    `  средняя SE якорных заданий (${anchorPairs[0]?.c.responses ?? 0} ответов): ${seOf(anchorPairs).toFixed(3)}`,
  );
  console.log(
    `  средняя SE остальных (${singlePairs[0]?.c.responses ?? 0} ответов):        ${seOf(singlePairs).toFixed(3)}`,
  );

  console.log(
    "\nЯкоря держат начало отсчёта: трудности якорных заданий взяты из варианта A и не",
  );
  console.log(
    "пересчитываются, поэтому новые задания ложатся на уже существующую шкалу банка.",
  );
  console.log("\n=== 6. УТЁКШИЙ ЯКОРЬ =============================================");
  const leakedItem = items.find(
    (i) => i.variant === "A" && i.task === LEAKED_ANCHOR_TASK,
  ) as SeededItem;
  console.log(
    `Якорь ${itemCode(leakedItem.id, leakedItem.task)} когорта B решает так, будто знала ответ:`,
  );
  console.log(`он легче для неё на ${LEAK_SIZE.toFixed(1)} логита, хотя это то же самое задание.`);
  console.log("");
  console.log("Само по себе связывание этого не заметит: шкалы совместятся, и перекос размажется");
  console.log("по всем восьми якорям. Диагностика дрейфа сравнивает каждый якорь с самим собой");
  console.log("после совмещения — и уехавший виден отдельно от остальных.");
  console.log("");
  console.log("Смотрите на странице шкалы Раша, раздел «Дрейф общих заданий».");

  console.log("\n=== 7. ВАРИАНТ БЕЗ ЯКОРЕЙ ========================================");
  console.log(
    `Вариант C заведён нарочно неправильно: ${ORPHAN_COHORT_SIZE} учеников, 43 своих задания,`,
  );
  console.log("ни одного общего с A и B и ни одного общего ученика.");
  console.log("");
  console.log("Матрица ответов распадается на два несвязных куска. JMLE на таких данных не падает");
  console.log("и не предупреждает: он сойдётся и выдаст числа, но каждый кусок центрируется на");
  console.log("своих заданиях, и разность трудностей между кусками — чистый артефакт.");
  console.log("");
  console.log("Платформа считает только крупнейший кусок. Задания варианта C не получают оценок");
  console.log("вовсе — не приблизительных, а никаких, ровно как задание ниже порога ответов.");
  console.log("На странице шкалы Раша он назван по имени: «Варианты вне общей шкалы».");

  console.log(
    `\nВ дашборде варианты A и B посчитаны вместе — общие задания связывают их сами. Откройте банк\n` +
      `демо-учителя: у каждого задания стоит трудность в логитах, SE и infit/outfit.`,
  );
}

// --- вход --------------------------------------------------------------

if (process.env.RASCH_DEMO !== "yes") {
  console.error("Откажусь работать: поставьте RASCH_DEMO=yes, чтобы подтвердить намерение.");
  process.exit(1);
}

const command = process.argv[2] ?? "seed";

if (command === "purge") {
  await purge();
} else if (command === "seed") {
  await seed();
} else if (command === "password") {
  const password = process.env.DEMO_PASSWORD ?? "";
  if (password.length < 10) {
    console.error("Нужен DEMO_PASSWORD длиной не меньше 10 символов.");
    process.exit(1);
  }
  const tenant = await findTenant();
  if (!tenant) {
    console.error("Демо-арендатора нет: сначала seed.");
    process.exit(1);
  }
  await db
    .update(staffUsers)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(eq(staffUsers.id, tenant.staffId));
  console.log(`Пароль демо-учителя «${USERNAME}» обновлён.`);
} else {
  console.error(`Неизвестная команда «${command}». Есть: seed, password, purge.`);
  process.exit(1);
}

await queryClient.end();
