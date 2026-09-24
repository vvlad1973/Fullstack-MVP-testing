/**
 * @module scripts/db/seed-psychometrics-demo
 * @description PRD-66: синтетические данные для приёмки психометрики.
 *
 * Приёмку вкладки «Качество заданий» нельзя провести на живой дев-базе: там два-три
 * прохождения на тест, и экран честно отвечает «мало данных» — то есть ни одно утверждение о
 * числах проверить нечем. Нужны данные, где КАЖДЫЙ случай представлен нарочно.
 *
 * Скрипт заводит три теста, и каждый отвечает за свою группу утверждений:
 *
 * 1. «Оцениваемый» — восемь заданий, шестьдесят участников: нормальные задания разной
 *    трудности, испорченный ключ, слишком лёгкое, на уровне угадывания, частичный кредит,
 *    «отвечают не читая» и задание с ДВУМЯ редакциями содержания (для таблицы версий).
 * 2. «Измерительный» — две шкалы PRD-5 по четыре пункта: обратный пункт с неперевёрнутым
 *    вкладом (работает против шкалы), мёртвый пункт и нормальные.
 * 3. «Смешанный источник» — те же задания, но часть прохождений пришла импортом, с партией:
 *    на нём проверяются баннер смещения по доле импорта и снятие партии с учёта.
 *
 * ДАННЫЕ СИНТЕТИЧЕСКИЕ И ПОМЕЧЕНЫ. Всё, что скрипт создаёт, несёт префикс «PRD-66 демо», и
 * `--drop` убирает это подчистую: дев-база общая, и мусор в ней виден каждой сессии.
 *
 * Required environment variables:
 *   - DATABASE_URL   база, в которую кладём демо-данные
 *
 * Usage:
 *   npm run psycho:demo         — создать
 *   npm run psycho:demo -- --drop — убрать
 */

import { randomUUID } from "node:crypto";

import pg from "pg";

import { computePsychoHash } from "../../shared/questions/psycho-hash";
import { loadEnv, loadConfiguration } from "../../server/config-loader.mjs";

const { Pool } = pg;

/** Метка, по которой демо-данные узнаются и удаляются. */
const MARK = "PRD-66 демо";

/** Сколько участников в каждом демо-тесте: порог надёжного коэффициента — сто наблюдений. */
const PEOPLE = 60;

/** Один вариант ответа: текст и то, верен ли он. */
interface OptionSpec {
  text: string;
  correct?: boolean;
}

/** Задание демо-банка. */
interface QuestionSpec {
  id: string;
  prompt: string;
  type: "single" | "scale";
  options: OptionSpec[];
  /** Трудность, заявленная автором: против неё экран ставит наблюдаемую (FR-18). */
  declared: number | null;
}

/** Как участник отвечает на задание — зависит от его способности. */
type Behaviour = (ability: number, index: number) => { earned: number; possible: number; choice: number };

/** Текст задания и варианты в форме, которую хранит база. */
function dataJsonOf(question: QuestionSpec): Record<string, unknown> {
  return { options: question.options.map(option => option.text) };
}

/** Эталон: индекс верного варианта; у измерительного задания эталона нет вовсе. */
function correctJsonOf(question: QuestionSpec): Record<string, unknown> {
  if (question.type === "scale") return {};
  const index = question.options.findIndex(option => option.correct);
  return index >= 0 ? { correctIndex: index } : {};
}

/** Отпечаток редакции — ТОЙ ЖЕ функцией, что пишет продукт: демо не должно врать о сериях. */
function hashOf(question: QuestionSpec): string {
  return computePsychoHash({
    type: question.type,
    prompt: question.prompt,
    dataJson: dataJsonOf(question),
    correctJson: correctJsonOf(question),
  });
}

/** Четыре варианта: первый верный, остальные — дистракторы. */
function options(correct: string, ...rest: string[]): OptionSpec[] {
  return [{ text: correct, correct: true }, ...rest.map(text => ({ text }))];
}

async function main(): Promise<void> {
  loadEnv();
  const cfg = await loadConfiguration();
  const databaseUrl = (cfg.database as { url?: string } | undefined)?.url ?? "";
  if (!databaseUrl) {
    console.error("[psycho-demo] DATABASE_URL must be set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  try {
    if (process.argv.includes("--drop")) {
      await drop(pool);
    } else {
      await seed(pool);
    }
  } finally {
    await pool.end();
  }
}

/** Убрать демо-данные подчистую: дев-база общая. */
async function drop(pool: pg.Pool): Promise<void> {
  const { rows: tests } = await pool.query<{ id: string }>(
    "SELECT id FROM tests WHERE title LIKE $1", [`${MARK}%`],
  );
  for (const test of tests) {
    await pool.query("DELETE FROM attempts WHERE test_id = $1", [test.id]);
    await pool.query("DELETE FROM scorm_answers WHERE attempt_id IN (SELECT id FROM scorm_attempts WHERE test_id = $1)", [test.id]);
    await pool.query("DELETE FROM scorm_attempts WHERE test_id = $1", [test.id]);
    await pool.query("DELETE FROM lms_import_batches WHERE test_id = $1", [test.id]);
    await pool.query("DELETE FROM question_measurements WHERE test_id = $1", [test.id]);
    await pool.query("DELETE FROM scales WHERE test_id = $1", [test.id]);
    await pool.query("DELETE FROM test_sections WHERE test_id = $1", [test.id]);
    await pool.query("DELETE FROM tests WHERE id = $1", [test.id]);
  }
  await pool.query(
    "DELETE FROM questions WHERE topic_id IN (SELECT id FROM topics WHERE name LIKE $1)", [`${MARK}%`],
  );
  await pool.query("DELETE FROM topics WHERE name LIKE $1", [`${MARK}%`]);
  const { rowCount } = await pool.query("DELETE FROM users WHERE email LIKE '%@prd66-demo.local'");
  console.log(`[psycho-demo] убрано тестов: ${tests.length}, участников: ${rowCount}`);
}

/** Завести участников демо: у каждого своя способность, заданная его номером. */
async function seedPeople(pool: pg.Pool, prefix: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < PEOPLE; i += 1) {
    const id = randomUUID();
    ids.push(id);
    await pool.query(
      `INSERT INTO users (id, email, email_hash, password_hash, name, status, gdpr_consent)
       VALUES ($1, $2, $3, 'demo', $4, 'active', true)`,
      [id, `${prefix}-${i}@prd66-demo.local`, `demo-${id}`, `${MARK}: участник ${i + 1}`],
    );
  }
  return ids;
}

/** Завести тему с заданиями и вернуть их. */
async function seedTopic(pool: pg.Pool, name: string, questions: QuestionSpec[]): Promise<string> {
  const topicId = randomUUID();
  await pool.query(
    "INSERT INTO topics (id, name, description) VALUES ($1, $2, $3)",
    [topicId, `${MARK}: ${name}`, "Синтетическая тема приёмки психометрики"],
  );
  for (const question of questions) {
    await pool.query(
      `INSERT INTO questions (id, topic_id, type, prompt, data_json, correct_json, psycho_hash, difficulty)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        question.id, topicId, question.type, question.prompt,
        JSON.stringify(dataJsonOf(question)),
        JSON.stringify(correctJsonOf(question)),
        hashOf(question),
        question.declared,
      ],
    );
  }
  return topicId;
}

/** Завести тест с одним разделом, выдающим всю тему. */
async function seedTest(pool: pg.Pool, title: string, topicId: string, questionCount: number): Promise<string> {
  const testId = randomUUID();
  await pool.query(
    `INSERT INTO tests (id, title, description, overall_pass_rule_json, default_question_points)
     VALUES ($1, $2, $3, $4, 1)`,
    [testId, `${MARK}: ${title}`, "Синтетический тест приёмки психометрики",
      JSON.stringify({ type: "percent", value: 70 })],
  );
  await pool.query(
    `INSERT INTO test_sections (id, test_id, topic_id, draw_count, draw_all, sort_order)
     VALUES ($1, $2, $3, $4, true, 0)`,
    [randomUUID(), testId, topicId, questionCount],
  );
  return testId;
}

/** Записать веб-попытку со всеми штампами, которые психометрика читает. */
async function seedAttempt(
  pool: pg.Pool,
  args: {
    testId: string;
    topicId: string;
    topicName: string;
    userId: string;
    questions: QuestionSpec[];
    behaviours: Behaviour[];
    ability: number;
    index: number;
    /** Отпечатки редакций — обычно текущие, но у одного задания демо их два (FR-49). */
    hashes: Record<string, string>;
    latencies: Record<string, number>;
  },
): Promise<void> {
  const answers: Record<string, unknown> = {};
  const outcomes: Array<{ questionId: string; result: string; earned: number; possible: number }> = [];

  args.questions.forEach((question, at) => {
    const behaviour = args.behaviours[at](args.ability, args.index);
    answers[question.id] = behaviour.choice;
    outcomes.push({
      questionId: question.id,
      result: behaviour.possible === 0
        ? "pending"
        : behaviour.earned === behaviour.possible ? "correct" : behaviour.earned > 0 ? "partial" : "incorrect",
      earned: behaviour.earned,
      possible: behaviour.possible,
    });
  });

  const earned = outcomes.reduce((sum, outcome) => sum + outcome.earned, 0);
  const possible = outcomes.reduce((sum, outcome) => sum + outcome.possible, 0);
  const startedAt = new Date(Date.UTC(2026, 8, 5 + (args.index % 14), 9, 0, 0));

  await pool.query(
    `INSERT INTO attempts (id, user_id, test_id, test_version, variant_json, answers_json, result_json, started_at, finished_at)
     VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8)`,
    [
      randomUUID(), args.userId, args.testId,
      JSON.stringify({
        sections: [{
          topicId: args.topicId,
          topicName: args.topicName,
          questionIds: args.questions.map(question => question.id),
        }],
        psychoHashes: args.hashes,
        latencyMs: args.latencies,
      }),
      JSON.stringify(answers),
      JSON.stringify({
        overallPercent: possible > 0 ? Math.round((earned / possible) * 100) : 0,
        overallPassed: possible > 0 && earned / possible >= 0.7,
        totalEarnedPoints: earned,
        totalPossiblePoints: possible,
        questionOutcomes: outcomes,
        gradingComplete: true,
      }),
      startedAt,
      new Date(startedAt.getTime() + 14 * 60 * 1000),
    ],
  );
}

/** Демо-тест 1: оцениваемый, со всеми симптомами заданий. */
async function seedGradedTest(pool: pg.Pool): Promise<string> {
  const questions: QuestionSpec[] = [
    {
      id: randomUUID(), type: "single", declared: 60,
      prompt: "Какой показатель относится к ликвидности?",
      options: options("Коэффициент текущей ликвидности", "Рентабельность продаж", "Оборачиваемость запасов", "Доля рынка"),
    },
    {
      id: randomUUID(), type: "single", declared: 45,
      prompt: "Что руководитель делает ПЕРВЫМ при несчастном случае с подчинённым?",
      options: options("Оказывает первую помощь", "Составляет акт", "Сообщает в профсоюз", "Проводит инструктаж"),
    },
    {
      id: randomUUID(), type: "single", declared: 70,
      prompt: "Кто проводит первичный инструктаж на рабочем месте?",
      options: options("Непосредственный руководитель", "Специалист по охране труда", "Кадровая служба", "Внешний подрядчик"),
    },
    {
      id: randomUUID(), type: "single", declared: 20,
      prompt: "Как расшифровывается ЭДО?",
      options: options("Электронный документооборот", "Единый договор обслуживания", "Электронная доверенность", "Единое дело организации"),
    },
    {
      id: randomUUID(), type: "single", declared: 50,
      prompt: "Какая мера относится к антикоррупционным?",
      options: options("Проверка контрагента перед сделкой", "Согласование подарка с руководителем", "Ежегодное обучение сотрудников", "Ведение бумажного журнала посещений"),
    },
    {
      id: randomUUID(), type: "single", declared: 55,
      prompt: "Оцените, какие шаги входят в инструктаж по охране труда: вводная часть, "
        + "разбор рабочего места, показ приёмов работы, проверка усвоения и оформление записи в журнале. "
        + "Какой из шагов выполняется ПОСЛЕ проверки усвоения?",
      options: options("Оформление записи в журнале", "Вводная часть", "Показ приёмов работы", "Разбор рабочего места"),
    },
    {
      id: randomUUID(), type: "single", declared: 65,
      prompt: "Какой документ подтверждает делегирование полномочий?",
      options: options("Приказ с перечнем полномочий", "Устное распоряжение", "Запись во внутреннем чате", "Служебная записка без резолюции"),
    },
    {
      id: randomUUID(), type: "single", declared: null,
      prompt: "Что из перечисленного относится к зоне ответственности аналитика?",
      options: options("Подготовка данных для решения", "Утверждение бюджета", "Наём сотрудников", "Подписание договоров"),
    },
  ];

  /** Решает ли участник задание такой трудности. */
  const solves = (threshold: number) => (ability: number) => ability >= threshold;

  const behaviours: Behaviour[] = [
    // Нормальные задания разной трудности: сильные решают чаще слабых.
    (a) => ({ earned: solves(0.30)(a) ? 1 : 0, possible: 1, choice: solves(0.30)(a) ? 0 : 1 }),
    (a) => ({ earned: solves(0.50)(a) ? 1 : 0, possible: 1, choice: solves(0.50)(a) ? 0 : 2 }),
    (a) => ({ earned: solves(0.20)(a) ? 1 : 0, possible: 1, choice: solves(0.20)(a) ? 0 : 3 }),
    // Слишком лёгкое: решают почти все.
    (_a, i) => ({ earned: i % 30 === 0 ? 0 : 1, possible: 1, choice: i % 30 === 0 ? 2 : 0 }),
    // ИСПОРЧЕННЫЙ КЛЮЧ: верный вариант выбирают слабые.
    (a) => ({ earned: solves(0.55)(a) ? 0 : 1, possible: 1, choice: solves(0.55)(a) ? 1 : 0 }),
    // «Отвечают не читая»: длинный текст, ответ наугад — верных около четверти.
    (_a, i) => ({ earned: i % 4 === 0 ? 1 : 0, possible: 1, choice: i % 4 === 0 ? 0 : (i % 3) + 1 }),
    // Частичный кредит: сильные берут полный балл, остальные половину.
    (a) => ({ earned: solves(0.50)(a) ? 2 : 1, possible: 2, choice: solves(0.50)(a) ? 0 : 1 }),
    // Задание с ДВУМЯ редакциями: до правки его решали хуже (см. `hashes` ниже).
    (a, i) => ({ earned: (i < PEOPLE / 2 ? solves(0.70)(a) : solves(0.35)(a)) ? 1 : 0, possible: 1, choice: 0 }),
  ];

  const topicId = await seedTopic(pool, "банк оцениваемого теста", questions);
  const testId = await seedTest(pool, "оцениваемый тест", topicId, questions.length);
  const people = await seedPeople(pool, "graded");

  const currentHashes = Object.fromEntries(questions.map(q => [q.id, hashOf(q)]));
  // Редакция ДО правки: та же функция, но по прежнему тексту — так серия и разрывается.
  const olderVersion = hashOf({ ...questions[7], prompt: "Что относится к зоне ответственности аналитика?" });

  for (const [index, userId] of people.entries()) {
    const ability = index / (PEOPLE - 1);
    const beforeEdit = index < PEOPLE / 2;

    await seedAttempt(pool, {
      testId, topicId, topicName: `${MARK}: банк оцениваемого теста`,
      userId, questions, behaviours, ability, index,
      hashes: { ...currentHashes, [questions[7].id]: beforeEdit ? olderVersion : currentHashes[questions[7].id] },
      latencies: Object.fromEntries(questions.map((question, at) => [
        question.id,
        // Шестое задание отвечают, не успев прочесть: полторы секунды на абзац.
        at === 5 ? 1500 : 18000 + at * 4000 + Math.round(ability * 15000),
      ])),
    });
  }
  return testId;
}

/** Демо-тест 2: измерительный — две шкалы PRD-5 с обратным пунктом и мёртвым. */
async function seedScaleTest(pool: pg.Pool): Promise<string> {
  const grades = ["Никогда", "Редко", "Иногда", "Часто", "Всегда"];
  const items: QuestionSpec[] = [
    "Я чувствую себя опустошённым к концу рабочего дня",
    "Мне трудно собраться с силами утром",
    "Работа истощает меня эмоционально",
    // Обратный пункт: согласие с ним означает НИЗКОЕ выгорание, а вклад не перевёрнут.
    "После выходных я возвращаюсь к работе с удовольствием",
    "Мне стало безразлично, что происходит с коллегами",
    "Я отстранённо отношусь к просьбам коллег",
    // Мёртвый пункт: отвечают одинаково почти все.
    "Я соблюдаю рабочий распорядок",
    "Я обсуждаю трудности с руководителем",
  ].map(prompt => ({
    id: randomUUID(), type: "scale" as const, declared: null, prompt,
    options: grades.map(text => ({ text })),
  }));

  const topicId = await seedTopic(pool, "банк измерительного теста", items);
  const testId = await seedTest(pool, "измерительный тест", topicId, items.length);
  const people = await seedPeople(pool, "scale");

  // Две шкалы по четыре пункта: истощение и отстранённость.
  const scales = [
    { id: randomUUID(), key: "exhaustion", label: "Эмоциональное истощение", items: items.slice(0, 4) },
    { id: randomUUID(), key: "detachment", label: "Отстранённость", items: items.slice(4) },
  ];
  for (const [order, scale] of scales.entries()) {
    await pool.query(
      `INSERT INTO scales (id, test_id, key, label, type, sort_order)
       VALUES ($1, $2, $3, $4, 'number', $5)`,
      [scale.id, testId, scale.key, scale.label, order],
    );
    for (const item of scale.items) {
      // Вклад градации равен её номеру: обратный пункт этим и портит шкалу — знак не перевёрнут.
      for (let grade = 0; grade < grades.length; grade += 1) {
        await pool.query(
          `INSERT INTO question_measurements (id, test_id, question_id, scale_id, source_type, source_key, value_json, weight)
           VALUES ($1, $2, $3, $4, 'option', $5, $6, 1)`,
          [randomUUID(), testId, item.id, scale.id, String(grade), JSON.stringify(grade)],
        );
      }
    }
  }

  const hashes = Object.fromEntries(items.map(item => [item.id, hashOf(item)]));
  for (const [index, userId] of people.entries()) {
    const level = index / (PEOPLE - 1);
    const answers: Record<string, unknown> = {};
    const outcomes: Array<{ questionId: string; result: string; earned: number; possible: number }> = [];

    items.forEach((item, at) => {
      const reverse = at === 3;
      const dead = at === 6;
      // Обычный пункт следует уровню шкалы; обратный идёт против него; мёртвый стоит на месте.
      const grade = dead ? 3 : reverse ? Math.round((1 - level) * 4) : Math.round(level * 4);
      answers[item.id] = grade;
      outcomes.push({ questionId: item.id, result: "pending", earned: 0, possible: 0 });
    });

    const startedAt = new Date(Date.UTC(2026, 8, 6 + (index % 12), 11, 0, 0));
    await pool.query(
      `INSERT INTO attempts (id, user_id, test_id, test_version, variant_json, answers_json, result_json, started_at, finished_at)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8)`,
      [
        randomUUID(), userId, testId,
        JSON.stringify({
          sections: [{ topicId, topicName: `${MARK}: банк измерительного теста`, questionIds: items.map(i => i.id) }],
          psychoHashes: hashes,
          latencyMs: Object.fromEntries(items.map((item, at) => [item.id, 12000 + at * 2000])),
        }),
        JSON.stringify(answers),
        JSON.stringify({ questionOutcomes: outcomes, gradingComplete: true, totalPossiblePoints: 0 }),
        startedAt,
        new Date(startedAt.getTime() + 9 * 60 * 1000),
      ],
    );
  }
  return testId;
}

/** Демо-тест 3: те же задания, но треть выборки пришла импортом — с партией. */
async function seedMixedSourceTest(pool: pg.Pool): Promise<string> {
  const questions: QuestionSpec[] = [
    {
      id: randomUUID(), type: "single", declared: 50,
      prompt: "Какой срок хранения журнала инструктажей?",
      options: options("Десять лет", "Один год", "Три года", "Бессрочно"),
    },
    {
      id: randomUUID(), type: "single", declared: 40,
      prompt: "Кто утверждает график отпусков?",
      options: options("Руководитель организации", "Профсоюз", "Кадровая служба", "Непосредственный руководитель"),
    },
    {
      id: randomUUID(), type: "single", declared: 60,
      prompt: "Что делать при получении подарка от контрагента?",
      options: options("Уведомить комплаенс", "Принять и не сообщать", "Вернуть без уведомления", "Передать коллеге"),
    },
  ];

  const topicId = await seedTopic(pool, "банк смешанного источника", questions);
  const testId = await seedTest(pool, "смешанный источник", topicId, questions.length);
  const people = await seedPeople(pool, "mixed");
  const hashes = Object.fromEntries(questions.map(q => [q.id, hashOf(q)]));

  const behaviours: Behaviour[] = [
    (a) => ({ earned: a >= 0.4 ? 1 : 0, possible: 1, choice: a >= 0.4 ? 0 : 1 }),
    (a) => ({ earned: a >= 0.6 ? 1 : 0, possible: 1, choice: a >= 0.6 ? 0 : 2 }),
    (a) => ({ earned: a >= 0.3 ? 1 : 0, possible: 1, choice: a >= 0.3 ? 0 : 3 }),
  ];

  // Две трети — веб, треть — импорт: доля импорта переваливает порог баннера (FR-40).
  const webPeople = people.slice(0, Math.round(PEOPLE * 0.66));
  for (const [index, userId] of webPeople.entries()) {
    await seedAttempt(pool, {
      testId, topicId, topicName: `${MARK}: банк смешанного источника`,
      userId, questions, behaviours, ability: index / (webPeople.length - 1), index, hashes,
      latencies: Object.fromEntries(questions.map((q, at) => [q.id, 15000 + at * 3000])),
    });
  }

  const batchId = randomUUID();
  await pool.query(
    `INSERT INTO lms_import_batches
       (id, test_id, file_name, file_hash, anonymized, source_anonymized, link_users, imported_by,
        rows_total, rows_created, rows_unmatched, counted)
     VALUES ($1, $2, $3, $4, true, false, false, $5, $6, $6, 2, true)`,
    [batchId, testId, `${MARK}.xlsx`, randomUUID(), people[0], PEOPLE - webPeople.length],
  );

  // Импортированные прохождения: балла за задание выгрузка не даёт — только бинарный исход.
  for (const [index] of people.slice(webPeople.length).entries()) {
    const attemptId = randomUUID();
    const ability = index / 10;
    const startedAt = new Date(Date.UTC(2026, 8, 20 + (index % 5), 10, 0, 0));
    await pool.query(
      `INSERT INTO scorm_attempts
         (id, package_id, session_id, test_id, origin, participant_key, user_id, lms_user_name,
          result_percent, result_passed, max_points, batch_id, started_at, finished_at, last_activity_at)
       VALUES ($1, null, null, $2, 'import', $3, null, null, $4, $5, 3, $6, $7, $8, $8)`,
      [
        attemptId, testId, `demo${String(index).padStart(60, "0")}`,
        Math.round(ability * 100), ability >= 0.7, batchId, startedAt,
        new Date(startedAt.getTime() + 12 * 60 * 1000),
      ],
    );
    for (const [at, question] of questions.entries()) {
      const correct = ability >= [0.4, 0.6, 0.3][at];
      await pool.query(
        `INSERT INTO scorm_answers
           (id, attempt_id, question_id, question_prompt, question_type, topic_id, user_answer_json,
            result, is_correct, points, max_points, latency_ms, answered_at)
         VALUES ($1, $2, $3, $4, 'single', $5, $6, $7, $8, null, null, $9, $10)`,
        [
          randomUUID(), attemptId, question.id, question.prompt, topicId,
          JSON.stringify([correct ? 0 : 1]),
          correct ? "correct" : "incorrect", correct,
          14000 + at * 2000, new Date(startedAt.getTime() + at * 60 * 1000),
        ],
      );
    }
  }
  return testId;
}

/** Завести все три демо-теста. */
async function seed(pool: pg.Pool): Promise<void> {
  // Повторный запуск не копит дубли: демо — это состояние, а не журнал.
  await drop(pool);

  const graded = await seedGradedTest(pool);
  const scales = await seedScaleTest(pool);
  const mixed = await seedMixedSourceTest(pool);

  console.log(`[psycho-demo] оцениваемый тест:   ${graded}`);
  console.log(`[psycho-demo] измерительный тест: ${scales}`);
  console.log(`[psycho-demo] смешанный источник: ${mixed}`);
  console.log(`[psycho-demo] участников: ${PEOPLE * 3}; убрать всё: npm run psycho:demo -- --drop`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`[psycho-demo] ${(error as Error).message}`);
    process.exit(1);
  },
);
