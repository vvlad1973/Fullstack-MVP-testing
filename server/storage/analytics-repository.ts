/**
 * @module server/storage/analytics-repository
 * @description PRD-56 FR-33: чтение прохождений ОБОИХ источников одной выборкой.
 *
 * Веб-попытки (`attempts`) и строки LMS (`scorm_attempts`) живут в разных таблицах, но экран
 * показывает их одним списком, сортирует по одной оси и догружает порциями при прокрутке
 * (FR-01c). Значит отбор, порядок и порция обязаны считаться ЗАПРОСОМ: слияние двух прочитанных
 * целиком таблиц в памяти даёт неверные порции, как только источников становится два.
 *
 * Репозиторий отдаёт сырые строки — приведение к наблюдению живёт в сервисе, потому что зависит
 * от правил оценивания, а не от хранения.
 */
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";

import { db } from "../db";
import {
  attempts, scormAnswers, scormAttempts, scormPackages, tests, userGroups, users,
  type Attempt, type ScormAttempt,
} from "@shared/schema";

/** Откуда приехало прохождение. Совпадает с `ObservationSource` сервиса. */
export type ObservationSourceName = "web" | "telemetry" | "import";

/** Исход прохождения. Совпадает с `ObservationOutcome` сервиса. */
export type ObservationOutcomeName = "passed" | "failed" | "completed" | "incomplete";

/** Условия отбора. Пустой объект — всё, что есть. */
export interface ObservationQuery {
  /** Тесты выборки. `undefined` — без ограничения по тесту. */
  testIds?: string[];
  groupIds?: string[];
  sources?: ObservationSourceName[];
  outcomes?: ObservationOutcomeName[];
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
  /** Ни одна строка подойти не может: доступных тестов нет вовсе. */
  impossible?: boolean;
  /**
   * Чем упорядочить выборку. Умолчание — дата начала по убыванию.
   *
   * Сортировка обязана быть здесь, а не в компоненте: строки приходят порциями, и разложить
   * по столбцу можно лишь то, что уже пришло, — «худший результат» на второй странице так
   * не найти никогда.
   */
  sort?: ObservationSort;
  dir?: "asc" | "desc";
}

/** Столбцы реестра, по которым он сортируется. Совпадают с колонками экрана. */
export type ObservationSort = "participant" | "test" | "date" | "result" | "outcome" | "source";

export interface ObservationRows {
  web: Attempt[];
  lms: ScormAttempt[];
  /** Порядок строк выборки: сервис раскладывает по нему нормализованные наблюдения. */
  order: Array<{ id: string; source: ObservationSourceName }>;
  /** Сколько прохождений подошло под условия — независимо от лимита. */
  total: number;
}

/**
 * Исход, вычисленный в SQL.
 *
 * Повторяет правило сервиса, и иначе нельзя: фильтр по исходу обязан работать ДО лимита, иначе
 * порция вернёт меньше строк, чем обещала, а общее число перестанет отвечать на «сколько всего».
 * Что оба выражения дают одно и то же, стережёт интеграционный тест.
 *
 * @param finished завершённость прохождения — у источников она видна по-разному
 * @param adaptive адаптивное прохождение: его судят подтверждённые уровни, а не доля баллов,
 *   поэтому вердикт у него есть и без достижимых баллов и без порога у теста
 * @param possiblePoints единицы оценивания строки
 * @param passed записанный вердикт
 */
function outcomeSql(
  finished: unknown,
  adaptive: unknown,
  possiblePoints: unknown,
  passed: unknown,
) {
  /** Вердикт как таковой: он же хвост общего правила. */
  const verdict = sql`case
    when ${passed} is null then 'completed'
    when ${passed} then 'passed'
    else 'failed'
  end`;

  return sql<string>`case
    when not ${finished} then 'incomplete'
    when ${adaptive} then ${verdict}
    when coalesce(${possiblePoints}, 0) <= 0 then 'completed'
    when coalesce(${tests.overallPassRuleJson} ->> 'type', 'none') = 'none' then 'completed'
    else ${verdict}
  end`;
}

export class AnalyticsRepository {
  /**
   * Страница прохождений обоих источников.
   *
   * Порядок устойчив: дата начала по убыванию, затем идентификатор — у прохождений одной
   * секунды иначе нет определённого места, и при догрузке строки терялись бы или двоились.
   */
  async selectObservations(query: ObservationQuery): Promise<ObservationRows> {
    /** `false`, когда ни одна строка источника подойти не может. */
    const NOTHING = sql`false`;

    /**
     * Участник состоит в одной из групп отбора.
     *
     * «Группа» в реестре значит то же, что во всём продукте, — членство человека
     * (`user_groups`). У импортированной строки к этому добавляется метка группы, которую
     * проставил импорт (PRD-54): участник там может быть не заведён вовсе.
     */
    const inGroups = (userIdColumn: unknown, ids: string[]) => sql`exists (
      select 1 from ${userGroups}
      where ${userGroups.userId} = ${userIdColumn}
        and ${userGroups.groupId} in ${ids}
    )`;
    const { testIds, groupIds, sources, outcomes } = query;

    // Единицы оценивания: достижимые баллы, а где их не записали — сам факт посчитанного
    // процента. Правило повторяет `gradedUnits` сервиса; у теста без проходного балла оба
    // признака не считаются, и это делает ветка `overall_pass_rule_json` внутри `outcomeSql`.
    const webGraded = sql`coalesce(
      (${attempts.resultJson} ->> 'totalPossiblePoints')::numeric,
      case when (${attempts.resultJson} ->> 'overallPercent') is not null then 1 else 0 end)`;
    // Прохождение состоялось, если посчитан результат, даже когда отметка завершения не
    // проставлена: такие строки в базе есть, и правило сервиса их не теряет — запрос тоже
    // не должен, иначе фильтр «завершено» отбирает не то, что показывает экран.
    const webFinished = sql`(${attempts.finishedAt} is not null or ${attempts.resultJson} is not null)`;
    const webOutcome = outcomeSql(
      webFinished,
      sql`(${attempts.resultJson} ->> 'mode') = 'adaptive'`,
      webGraded,
      sql`(${attempts.resultJson} ->> 'overallPassed')::boolean`,
    );
    // Оценённость строки из LMS видна по проценту, когда баллов нет: телеметрия не всегда
    // сообщает `max_points`. То же правило, что в нормализации сервиса.
    const lmsGraded = sql`coalesce(${scormAttempts.maxPoints},
      case when ${scormAttempts.resultPercent} is not null then 1 else 0 end)`;
    // Телеметрия заводит строку при СТАРТЕ и обновляет по ходу, поэтому признак завершения у
    // неё один — отметка времени; режим прохождения она не сообщает вовсе, и адаптивных
    // разрезов у этого источника нет (то же, что в нормализации сервиса).
    const lmsOutcome = outcomeSql(
      sql`${scormAttempts.finishedAt} is not null`,
      sql`false`,
      lmsGraded,
      scormAttempts.resultPassed,
    );

    const webWhere = and(
      ...(testIds ? [inArray(attempts.testId, testIds)] : []),
      ...(query.from ? [gte(attempts.startedAt, query.from)] : []),
      ...(query.to ? [lte(attempts.startedAt, query.to)] : []),
      ...(outcomes?.length ? [inArray(webOutcome, outcomes)] : []),
      ...(groupIds?.length ? [inGroups(attempts.userId, groupIds)] : []),
      ...(sources?.length && !sources.includes("web") ? [NOTHING] : []),
      ...(query.impossible ? [NOTHING] : []),
    );

    const lmsOrigins = (sources?.length ? sources : ["telemetry", "import"]).filter(
      (s): s is "telemetry" | "import" => s !== "web",
    );
    /**
     * Тест строки из LMS. `scorm_attempts.test_id` — источник истины, но у части старых строк
     * телеметрии его нет: их тест известен только через пакет. Тот же порядок, что в
     * `attemptTestId`, иначе выборка по тесту молча теряет такие прохождения.
     */
    const lmsTestId = sql`coalesce(${scormAttempts.testId}, ${scormPackages.testId})`;

    const lmsWhere = and(
      ...(testIds ? [inArray(lmsTestId, testIds)] : []),
      ...(query.from ? [gte(scormAttempts.startedAt, query.from)] : []),
      ...(query.to ? [lte(scormAttempts.startedAt, query.to)] : []),
      ...(groupIds?.length
        ? [or(
            inArray(scormAttempts.groupId, groupIds),
            inGroups(scormAttempts.userId, groupIds),
          )!]
        : []),
      ...(outcomes?.length ? [inArray(lmsOutcome, outcomes)] : []),
      ...(lmsOrigins.length ? [inArray(scormAttempts.origin, lmsOrigins)] : [NOTHING]),
      ...(query.impossible ? [NOTHING] : []),
    );

    /**
     * Подписи и величины, по которым реестр сортируется, — в обоих источниках по одному
     * правилу, иначе половина выборки встанет не туда.
     *
     * Участник: у веб-попытки это имя учётной записи, у строки из LMS — имя, пришедшее из
     * отчёта, а где и его нет — псевдоним (то же правило, что рисует подпись на экране).
     * Процент: у веба он лежит в итоге попытки, у LMS — своей колонкой.
     */
    // `nullif` не украшение: безымянная строка — это «участник неизвестен», и по алфавиту она
    // не стоит нигде. Пустая строка встала бы в начало возрастающей сортировки, заняв место
    // перед реальными людьми; NULL уходит в конец вместе с прочими «нет данных».
    const webParticipant = sql`nullif(${users.name}, '')`;
    const lmsParticipant = sql`nullif(coalesce(${scormAttempts.lmsUserName}, ${scormAttempts.participantKey}), '')`;
    const webPercent = sql`(${attempts.resultJson} ->> 'overallPercent')::numeric`;
    const lmsPercent = scormAttempts.resultPercent;

    /**
     * Ключ сортировки едет ОТДЕЛЬНОЙ колонкой объединения, а не выражением над номером.
     *
     * Сослаться на колонку union можно только её номером, но номер — это ссылка, а не
     * значение: `(3 is null)` PostgreSQL понимает как условие над числом три и запрос
     * отвергает. Поэтому выбранная величина и признак её отсутствия считаются в каждой ветке
     * заранее, и порядок задаётся уже по ним.
     */
    const sortOf = (of: Record<ObservationSort, unknown>) => of[query.sort ?? "date"];
    /**
     * Процент как ВЕЛИЧИНА СОРТИРОВКИ подчиняется тому же правилу, что колонка на экране:
     * результата нет у незавершённого прохождения; у теста без проходного балла ноль процентов
     * не результат, а отсутствие оценивания (PRD-29 §6.7); и там, где оценивать было нечего,
     * его тоже нет. Все три случая уходят в конец вместе с прочими «нет данных» — те же три
     * условия, по которым процент становится прочерком в колонке «Результат».
     *
     * Без этого сортировка спорила бы с тем, что видно: наверху вставали бы строки, у которых
     * в колонке «Результат» стоит прочерк.
     */
    const gradedPercent = (percent: unknown, finished: unknown, graded: unknown) => sql`case
      when not ${finished} then null
      when coalesce(${tests.overallPassRuleJson} ->> 'type', 'none') = 'none' then null
      when coalesce(${graded}, 0) <= 0 then null
      else ${percent}
    end`;
    /**
     * Ключ сортировки считается СВОИМИ выражениями, а не теми, что стоят в выборке.
     *
     * Выражение выборки несёт псевдоним, и подстановка его же во второе место даёт ссылку на
     * псевдоним — а ссылаться на псевдоним внутри того же SELECT нельзя: запрос падает на
     * «column "participant" does not exist».
     */
    const webSortKey = sortOf({
      date: attempts.startedAt,
      participant: sql`nullif(${users.name}, '')`,
      test: sql`coalesce(${tests.title}, '')`,
      result: gradedPercent(
        sql`(${attempts.resultJson} ->> 'overallPercent')::numeric`,
        webFinished,
        webGraded,
      ),
      outcome: outcomeSql(
        webFinished,
        sql`(${attempts.resultJson} ->> 'mode') = 'adaptive'`,
        webGraded,
        sql`(${attempts.resultJson} ->> 'overallPassed')::boolean`,
      ),
      source: sql`'web'`,
    });
    const lmsSortKey = sortOf({
      date: scormAttempts.startedAt,
      participant: sql`nullif(coalesce(${scormAttempts.lmsUserName}, ${scormAttempts.participantKey}), '')`,
      test: sql`coalesce(${tests.title}, '')`,
      result: gradedPercent(
        scormAttempts.resultPercent,
        sql`${scormAttempts.finishedAt} is not null`,
        lmsGraded,
      ),
      outcome: outcomeSql(
        sql`${scormAttempts.finishedAt} is not null`,
        sql`false`,
        lmsGraded,
        scormAttempts.resultPassed,
      ),
      source: scormAttempts.origin,
    });

    const webKeys = db
      .select({
        id: attempts.id,
        source: sql<string>`'web'`.as("source"),
        startedAt: attempts.startedAt,
        participant: webParticipant.as("participant"),
        testTitle: sql`coalesce(${tests.title}, '')`.as("test_title"),
        percent: webPercent.as("percent"),
        outcome: webOutcome.as("outcome"),
        sortEmpty: sql`(${webSortKey} is null)`.as("sort_empty"),
        sortKey: sql`${webSortKey}`.as("sort_key"),
      })
      .from(attempts)
      .leftJoin(tests, eq(tests.id, attempts.testId))
      .leftJoin(users, eq(users.id, attempts.userId))
      .where(webWhere);

    const lmsKeys = db
      .select({
        id: scormAttempts.id,
        source: scormAttempts.origin,
        startedAt: scormAttempts.startedAt,
        participant: lmsParticipant.as("participant"),
        testTitle: sql`coalesce(${tests.title}, '')`.as("test_title"),
        percent: lmsPercent,
        outcome: lmsOutcome.as("outcome"),
        sortEmpty: sql`(${lmsSortKey} is null)`.as("sort_empty"),
        sortKey: sql`${lmsSortKey}`.as("sort_key"),
      })
      .from(scormAttempts)
      .leftJoin(scormPackages, eq(scormPackages.id, scormAttempts.packageId))
      .leftJoin(tests, eq(tests.id, sql`coalesce(${scormAttempts.testId}, ${scormPackages.testId})`))
      .where(lmsWhere);

    /**
     * Порядок задан НОМЕРАМИ колонок: сослаться на колонку объединения иначе нельзя — своей
     * таблицы у неё нет. Восьмая колонка — признак «величины нет», девятая — сама величина.
     *
     * Первым ключом идёт признак пустоты, и всегда по возрастанию: строки без величины
     * оказываются в конце при любом направлении, иначе сортировка по результату начиналась бы
     * с прочерков. Последним — идентификатор: у прохождений одной секунды (или с одинаковым
     * результатом) иначе нет определённого места, и при догрузке порциями строки терялись бы
     * или двоились.
     */
    const direction = query.dir === "asc" ? "asc" : "desc";
    /**
     * Объединение заворачивается в подзапрос, и порядок задаётся по ИМЕНАМ его колонок.
     *
     * Ссылаться номерами тоже можно, но номер — это ссылка, а не значение: условие над ним
     * PostgreSQL отвергает, а `nulls last` при этом молча теряется. Имя колонки подзапроса
     * снимает оба ограничения разом и переживает добавление новой колонки в выборку.
     */
    const union = unionAll(webKeys, lmsKeys).as("observations");
    const ordered = db
      .select({ id: union.id, source: union.source })
      .from(union)
      .orderBy(
        // Первый ключ — «величины нет», всегда по возрастанию: такие строки уходят в конец при
        // ЛЮБОМ направлении, иначе сортировка по результату начинается с прочерков.
        asc(union.sortEmpty),
        direction === "asc" ? asc(union.sortKey) : desc(union.sortKey),
        // Последний — идентификатор: у прохождений одной секунды (или с равным результатом)
        // иначе нет определённого места, и при догрузке порциями строки терялись бы.
        desc(union.id),
      );
    const limited = query.limit === undefined ? ordered : ordered.limit(query.limit);
    const keysQuery: PromiseLike<Array<{ id: string; source: string }>> =
      query.offset ? limited.offset(query.offset) : limited;

    const [keys, webTotal, lmsTotal] = await Promise.all([
      keysQuery,
      countOf(db.select({ n: sql<number>`count(*)::int` }).from(attempts)
        .leftJoin(tests, eq(tests.id, attempts.testId)).where(webWhere)),
      countOf(db.select({ n: sql<number>`count(*)::int` }).from(scormAttempts)
        .leftJoin(scormPackages, eq(scormPackages.id, scormAttempts.packageId))
        .leftJoin(tests, eq(tests.id, sql`coalesce(${scormAttempts.testId}, ${scormPackages.testId})`))
        .where(lmsWhere)),
    ]);

    const webIds = keys.filter(k => k.source === "web").map(k => k.id);
    const lmsIds = keys.filter(k => k.source !== "web").map(k => k.id);
    const [web, lms] = await Promise.all([
      webIds.length ? db.select().from(attempts).where(inArray(attempts.id, webIds)) : [],
      lmsIds.length
        ? db.select().from(scormAttempts).where(inArray(scormAttempts.id, lmsIds))
        : [],
    ]);

    return {
      web,
      lms,
      order: keys.map(k => ({ id: k.id, source: k.source as ObservationSourceName })),
      total: webTotal + lmsTotal,
    };
  }

  /**
   * Ответы прохождений теста, пришедших из LMS.
   *
   * Тест строки телеметрии берётся с тем же запасным путём, что и в выборке прохождений:
   * `scorm_attempts.test_id` — источник истины, но у части старых записей его нет, и тест
   * известен только через пакет. Без этого статистика вопроса молча теряет ровно те
   * прохождения, ради которых пакет и собирали.
   */
  async selectAnswersForTest(testId: string): Promise<TestAnswerRow[]> {
    const rows = await db
      .select({
        questionId: scormAnswers.questionId,
        attemptId: scormAnswers.attemptId,
        result: scormAnswers.result,
        latencyMs: scormAnswers.latencyMs,
        points: scormAnswers.points,
        maxPoints: scormAnswers.maxPoints,
        userAnswer: scormAnswers.userAnswerJson,
        origin: scormAttempts.origin,
      })
      .from(scormAnswers)
      .innerJoin(scormAttempts, eq(scormAttempts.id, scormAnswers.attemptId))
      .leftJoin(scormPackages, eq(scormPackages.id, scormAttempts.packageId))
      .where(eq(sql`coalesce(${scormAttempts.testId}, ${scormPackages.testId})`, testId));

    return rows.map(row => ({
      questionId: row.questionId,
      attemptId: row.attemptId,
      result: (row.result ?? "incorrect") as TestAnswerRow["result"],
      latencyMs: row.latencyMs ?? null,
      points: row.points ?? null,
      maxPoints: row.maxPoints ?? null,
      userAnswer: row.userAnswer,
      origin: (row.origin ?? "telemetry") as ObservationSourceName,
    }));
  }

  /**
   * PRD-56 FR-21: значения шкал прохождений теста — ОБА источника одной выборкой.
   *
   * Хранятся они по-разному: веб пишет `result_json.scaleResults` записью с сырым значением и
   * подписью уровня, LMS — `scales_json` картой «ключ -> число». Здесь обе формы приводятся к
   * числу: подпись уровня не читается ни у одного источника, потому что импорт её не хранит
   * вовсе, и считать уровень по-разному для двух источников значило бы получить два разных
   * распределения на одних данных.
   *
   * Запасной путь к тесту через пакет — тот же, что в остальных выборках.
   */
  async selectScaleValuesForTest(testId: string): Promise<ScaleValuesRow[]> {
    const [webRows, lmsRows] = await Promise.all([
      db
        .select({ id: attempts.id, resultJson: attempts.resultJson })
        .from(attempts)
        .where(and(eq(attempts.testId, testId), sql`${attempts.resultJson} is not null`)),
      db
        .select({
          id: scormAttempts.id,
          origin: scormAttempts.origin,
          scalesJson: scormAttempts.scalesJson,
        })
        .from(scormAttempts)
        .leftJoin(scormPackages, eq(scormPackages.id, scormAttempts.packageId))
        .where(and(
          eq(sql`coalesce(${scormAttempts.testId}, ${scormPackages.testId})`, testId),
          sql`${scormAttempts.finishedAt} is not null`,
        )),
    ]);

    const out: ScaleValuesRow[] = [];
    for (const row of webRows) {
      const stored = (row.resultJson as { scaleResults?: Record<string, unknown> } | null)
        ?.scaleResults;
      out.push({ attemptId: row.id, source: "web", values: numbersOf(stored, "raw") });
    }
    for (const row of lmsRows) {
      out.push({
        attemptId: row.id,
        source: (row.origin ?? "telemetry") as ObservationSourceName,
        values: numbersOf(row.scalesJson as Record<string, unknown> | null),
      });
    }
    return out;
  }
}

/** Ответ на вопрос, записанный прохождением из LMS. */
export interface TestAnswerRow {
  questionId: string;
  /** Прохождение ответа: по нему считаются доли ПРОХОЖДЕНИЙ, а не ответов (FR-14a). */
  attemptId: string;
  /** `neutral` — измерительный ответ: ему нечего было оценивать (PRD-54). */
  result: "correct" | "incorrect" | "neutral";
  /** Время на вопрос; `null` — не измерялось (PRD-55). */
  latencyMs: number | null;
  /** Баллы ответа; `null` — пакет их не сообщил либо оценивать было нечего. */
  points: number | null;
  maxPoints: number | null;
  /**
   * Сам ответ, как его дал участник (PRD-56 FR-22). Нужен разбросу ответов измерительного
   * задания: у него нет эталона, и рассказать о нём можно только тем, ЧТО выбирали.
   */
  userAnswer: unknown;
  origin: ObservationSourceName;
}

/** Значения шкал ОДНОГО прохождения, приведённые к числу. */
export interface ScaleValuesRow {
  attemptId: string;
  source: ObservationSourceName;
  /** «Ключ шкалы -> значение». Шкала без посчитанного значения ключа не получает. */
  values: Record<string, number>;
}

/**
 * Достать числа из записи значений.
 *
 * @param stored карта «ключ -> значение» либо «ключ -> запись со значением»
 * @param field поле записи, в котором лежит число; без него значение читается напрямую
 */
function numbersOf(stored: unknown, field?: string): Record<string, number> {
  if (!stored || typeof stored !== "object") return {};

  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(stored as Record<string, unknown>)) {
    const value = field !== undefined && raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)[field]
      : raw;
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** Развернуть запрос-счётчик в число. */
async function countOf(query: PromiseLike<Array<{ n: number }>>): Promise<number> {
  const rows = await query;
  return rows[0]?.n ?? 0;
}
