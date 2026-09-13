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
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";

import { db } from "../db";
import {
  attempts, scormAttempts, tests,
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
 */
function outcomeSql(finishedAt: unknown, possiblePoints: unknown, passed: unknown) {
  return sql<string>`case
    when ${finishedAt} is null then 'incomplete'
    when coalesce(${possiblePoints}, 0) <= 0 then 'completed'
    when coalesce(${tests.overallPassRuleJson} ->> 'type', 'none') = 'none' then 'completed'
    when ${passed} is null then 'completed'
    when ${passed} then 'passed'
    else 'failed'
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
    const { testIds, groupIds, sources, outcomes } = query;

    const webOutcome = outcomeSql(
      attempts.finishedAt,
      sql`(${attempts.resultJson} ->> 'totalPossiblePoints')::numeric`,
      sql`(${attempts.resultJson} ->> 'overallPassed')::boolean`,
    );
    const lmsOutcome = outcomeSql(
      scormAttempts.finishedAt,
      scormAttempts.maxPoints,
      scormAttempts.resultPassed,
    );

    const webWhere = and(
      ...(testIds ? [inArray(attempts.testId, testIds)] : []),
      ...(query.from ? [gte(attempts.startedAt, query.from)] : []),
      ...(query.to ? [lte(attempts.startedAt, query.to)] : []),
      ...(outcomes?.length ? [inArray(webOutcome, outcomes)] : []),
      // Группа веб-попытки выводится из членства пользователя — это отдельный разрез (FR-06).
      // Пока фильтр по группе отбирает только строки, которым группу проставил импорт.
      ...(groupIds?.length ? [NOTHING] : []),
      ...(sources?.length && !sources.includes("web") ? [NOTHING] : []),
      ...(query.impossible ? [NOTHING] : []),
    );

    const lmsOrigins = (sources?.length ? sources : ["telemetry", "import"]).filter(
      (s): s is "telemetry" | "import" => s !== "web",
    );
    const lmsWhere = and(
      ...(testIds ? [inArray(scormAttempts.testId, testIds)] : []),
      ...(query.from ? [gte(scormAttempts.startedAt, query.from)] : []),
      ...(query.to ? [lte(scormAttempts.startedAt, query.to)] : []),
      ...(groupIds?.length ? [inArray(scormAttempts.groupId, groupIds)] : []),
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
      .leftJoin(tests, eq(tests.id, scormAttempts.testId))
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
        .leftJoin(tests, eq(tests.id, scormAttempts.testId)).where(lmsWhere)),
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
}

/** Развернуть запрос-счётчик в число. */
async function countOf(query: PromiseLike<Array<{ n: number }>>): Promise<number> {
  const rows = await query;
  return rows[0]?.n ?? 0;
}
