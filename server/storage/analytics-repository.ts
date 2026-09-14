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
import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";

import { db } from "../db";
import {
  attempts, scormAnswers, scormAttempts, scormPackages, tests, userGroups,
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
}

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

    const webKeys = db
      .select({ id: attempts.id, source: sql<string>`'web'`, startedAt: attempts.startedAt })
      .from(attempts)
      .leftJoin(tests, eq(tests.id, attempts.testId))
      .where(webWhere);

    const lmsKeys = db
      .select({
        id: scormAttempts.id,
        source: scormAttempts.origin,
        startedAt: scormAttempts.startedAt,
      })
      .from(scormAttempts)
      .leftJoin(scormPackages, eq(scormPackages.id, scormAttempts.packageId))
      .leftJoin(tests, eq(tests.id, sql`coalesce(${scormAttempts.testId}, ${scormPackages.testId})`))
      .where(lmsWhere);

    // Сортировка задана номерами колонок — единственный способ сослаться на колонку
    // объединения, у которой нет своей таблицы.
    const ordered = unionAll(webKeys, lmsKeys).orderBy(sql`3 desc`, sql`1 desc`);
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
        result: scormAnswers.result,
        latencyMs: scormAnswers.latencyMs,
        origin: scormAttempts.origin,
      })
      .from(scormAnswers)
      .innerJoin(scormAttempts, eq(scormAttempts.id, scormAnswers.attemptId))
      .leftJoin(scormPackages, eq(scormPackages.id, scormAttempts.packageId))
      .where(eq(sql`coalesce(${scormAttempts.testId}, ${scormPackages.testId})`, testId));

    return rows.map(row => ({
      questionId: row.questionId,
      result: (row.result ?? "incorrect") as TestAnswerRow["result"],
      latencyMs: row.latencyMs ?? null,
      origin: (row.origin ?? "telemetry") as ObservationSourceName,
    }));
  }
}

/** Ответ на вопрос, записанный прохождением из LMS. */
export interface TestAnswerRow {
  questionId: string;
  /** `neutral` — измерительный ответ: ему нечего было оценивать (PRD-54). */
  result: "correct" | "incorrect" | "neutral";
  /** Время на вопрос; `null` — не измерялось (PRD-55). */
  latencyMs: number | null;
  origin: ObservationSourceName;
}

/** Развернуть запрос-счётчик в число. */
async function countOf(query: PromiseLike<Array<{ n: number }>>): Promise<number> {
  const rows = await query;
  return rows[0]?.n ?? 0;
}
