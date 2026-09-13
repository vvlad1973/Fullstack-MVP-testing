/**
 * @module server/services/analytics/observations
 * @description PRD-56 FR-33: один слой наблюдений для обеих страниц аналитики.
 *
 * До этого каждая ручка сама читала таблицу и сама решала, что считать прохождением: раздел
 * «Аналитика» складывал веб-попытки с телеметрией и импортом, а страница теста видела только
 * веб — из-за чего два экрана отвечали на один вопрос разными числами (раздел 1.1 спеки).
 * Здесь строка любого источника приводится к ОДНОЙ форме, и дальше её происхождение перестаёт
 * влиять на расчёт: источник остаётся признаком для фильтра, а не развилкой в коде.
 *
 * Модуль чистый: ни запросов, ни Express. Чтение из базы живёт снаружи и передаёт сюда строки
 * вместе со справочниками, иначе нормализацию нельзя проверить без базы.
 */

import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";

import { attempts, scormAttempts, tests, users as usersTable } from "@shared/schema";
import { hasPronouncedVerdict, nothingToGrade } from "@shared/scoring/pass-rule";

import { db } from "../../db";
import { attemptParticipant, attemptTestId } from "./attempt-row";

/** Откуда приехало прохождение. Фильтр экрана говорит ровно в этих терминах. */
export type ObservationSource = "web" | "telemetry" | "import";

/**
 * Исход прохождения.
 *
 * `completed` — не «сдал наполовину», а прохождение БЕЗ вердикта: опросник ничего не оценивает,
 * и «не сдал» было бы про него ложью (PRD-29 §6.7). `incomplete` — попытка, которую не довели
 * до конца: у неё нет ни результата, ни исхода.
 */
export type ObservationOutcome = "passed" | "failed" | "completed" | "incomplete";

/** Одно прохождение, как его видит аналитика, независимо от источника. */
export interface Observation {
  id: string;
  source: ObservationSource;
  testId: string | null;
  userId: string | null;
  /** Подпись участника: имя, имя из LMS или псевдоним (PRD-54 раздел 12). */
  participant: string;
  participantKey: string | null;
  /** Группа, проставленная импортом. Членство пользователя в группах разрешается отдельно. */
  groupId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  /** Длительность прохождения; `null`, пока попытка не завершена. */
  durationMs: number | null;
  /** Результат в процентах; `null`, когда оценивать было нечего. */
  percent: number | null;
  /** Вердикт; `null`, когда его никто не выносил. */
  passed: boolean | null;
  outcome: ObservationOutcome;
  /** Версия публикации (PRD-15) и вариант выдачи (PRD-17) — разрезы вкладки «Выдача». */
  snapshotId: string | null;
  formId: string | null;
}

/** Справочники, общие для всех строк одного запроса. */
export interface ObservationContext {
  users: ReadonlyMap<string, { name: string | null }>;
  /** Тест объявляет проходной балл (`declaresPassThreshold`). */
  gradedTest: boolean | undefined;
}

export interface LmsObservationContext extends ObservationContext {
  /** Пакеты — запасной путь к тесту у старых строк телеметрии. */
  packages: ReadonlyMap<string, { testId: string | null }>;
}

interface WebAttemptRow {
  id: string;
  userId: string;
  testId: string;
  snapshotId?: string | null;
  variantJson?: unknown;
  resultJson?: unknown;
  startedAt: Date;
  finishedAt: Date | null;
}

interface LmsAttemptRow {
  id: string;
  packageId: string | null;
  testId: string | null;
  origin: "telemetry" | "import";
  userId: string | null;
  participantKey: string | null;
  groupId: string | null;
  lmsUserName: string | null;
  resultPercent: number | null;
  resultPassed: boolean | null;
  maxPoints: number | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** Достижимые баллы прохождения: по ним видно, было ли что оценивать. */
function possiblePointsOf(result: unknown): number {
  const value = (result as { totalPossiblePoints?: unknown } | null)?.totalPossiblePoints;
  return typeof value === "number" ? value : 0;
}

/** Исход по завершённости и вердикту — единственное место, где он выводится. */
function outcomeOf(finished: boolean, passed: boolean | null): ObservationOutcome {
  if (!finished) return "incomplete";
  if (passed === null) return "completed";
  return passed ? "passed" : "failed";
}

function durationOf(startedAt: Date, finishedAt: Date | null): number | null {
  return finishedAt ? finishedAt.getTime() - startedAt.getTime() : null;
}

export const toObservation = {
  /** Веб-попытка (`attempts`). */
  web(row: WebAttemptRow, ctx: ObservationContext): Observation {
    const finished = row.finishedAt !== null;
    const result = row.resultJson as { overallPercent?: number; overallPassed?: boolean } | null;
    const possiblePoints = possiblePointsOf(result);
    const scored = finished && !nothingToGrade(possiblePoints);
    const pronounced = finished && hasPronouncedVerdict(ctx.gradedTest, possiblePoints);
    const passed = pronounced ? result?.overallPassed ?? null : null;

    return {
      id: row.id,
      source: "web",
      testId: row.testId,
      userId: row.userId,
      participant: attemptParticipant(
        { userId: row.userId, participantKey: null, lmsUserName: null },
        ctx.users,
      ),
      participantKey: null,
      groupId: null,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: durationOf(row.startedAt, row.finishedAt),
      percent: scored ? result?.overallPercent ?? null : null,
      passed,
      outcome: outcomeOf(finished, passed),
      snapshotId: row.snapshotId ?? null,
      formId: (row.variantJson as { formId?: string } | null)?.formId ?? null,
    };
  },

  /** Прохождение из LMS: живая телеметрия или импортированная выгрузка (`scorm_attempts`). */
  lms(row: LmsAttemptRow, ctx: LmsObservationContext): Observation {
    const finished = row.finishedAt !== null;
    const possiblePoints = row.maxPoints ?? 0;
    const scored = finished && !nothingToGrade(possiblePoints);
    const pronounced = finished && hasPronouncedVerdict(ctx.gradedTest, possiblePoints);
    const passed = pronounced ? row.resultPassed ?? null : null;

    return {
      id: row.id,
      source: row.origin,
      testId: attemptTestId(row, ctx.packages),
      userId: row.userId,
      participant: attemptParticipant(row, ctx.users),
      participantKey: row.participantKey,
      groupId: row.groupId,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: durationOf(row.startedAt, row.finishedAt),
      percent: scored ? row.resultPercent ?? null : null,
      passed,
      outcome: outcomeOf(finished, passed),
      // Версия публикации и вариант выдачи в LMS пока не доезжают: FR-19a заводит их
      // проносом в пакет и парсером выгрузок, до этого разрез по версиям видит только веб.
      snapshotId: null,
      formId: null,
    };
  },
};

/** Условия отбора прохождений. Пустой объект — всё, что доступно читателю. */
export interface ObservationFilter {
  testIds?: string[];
  groupIds?: string[];
  sources?: ObservationSource[];
  outcomes?: ObservationOutcome[];
  /** Период по дате НАЧАЛА прохождения. */
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Область видимости читателя — прямой ответ `readableTestScope`.
 *
 * Именно множество, а не предикат: область обязана попасть В УСЛОВИЕ запроса, иначе лимит
 * отсчитается до отсечения недоступных тестов и порция вернёт меньше строк, чем обещала.
 */
export interface ObservationScope {
  all: boolean;
  ids: ReadonlySet<string>;
}

export interface ObservationPage {
  rows: Observation[];
  /** Сколько прохождений подошло под условия — независимо от лимита. */
  total: number;
}

/**
 * Исход, вычисленный в SQL.
 *
 * Повторяет {@link outcomeOf}, и иначе нельзя: фильтр по исходу обязан работать ДО лимита,
 * иначе порция вернёт меньше строк, чем обещала, а `total` перестанет отвечать на «сколько
 * всего». Что оба выражения дают одно и то же, стережёт интеграционный тест: он сверяет
 * выборку по исходу с полями нормализованных строк.
 *
 * @param finishedAt столбец даты завершения
 * @param possiblePoints выражение достижимых баллов
 * @param passed выражение вердикта
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

/**
 * Прохождения по условиям — из обоих источников, одним списком.
 *
 * Отбор, сортировка и порция считаются ЗАПРОСОМ: реестр подгружается при прокрутке (FR-01c),
 * и порядок обязан быть устойчивым, поэтому сортировка идёт по дате начала и по идентификатору
 * — у прохождений одной секунды иначе нет определённого порядка.
 *
 * Область видимости (FR-35) попадает в условие, а не отсекает строки после лимита.
 */
export async function loadObservations(
  filter: ObservationFilter,
  scope: ObservationScope,
): Promise<ObservationPage> {
  const testIds = filter.testIds?.length ? filter.testIds : undefined;
  const sources = filter.sources?.length ? filter.sources : undefined;
  const outcomes = filter.outcomes?.length ? filter.outcomes : undefined;

  // Пересечение «что просили» и «что доступно»: пустое множество означает, что доступного
  // нет вовсе, и запрос обязан вернуть ноль строк, а не всё подряд.
  const allowed = scope.all
    ? testIds
    : (testIds ?? [...scope.ids]).filter(id => scope.ids.has(id));
  const impossible = !scope.all && allowed!.length === 0;

  const webOutcome = outcomeSql(
    attempts.finishedAt,
    sql`(${attempts.resultJson} ->> 'totalPossiblePoints')::numeric`,
    sql`(${attempts.resultJson} ->> 'overallPassed')::boolean`,
  );
  const lmsOutcome = outcomeSql(scormAttempts.finishedAt, scormAttempts.maxPoints, scormAttempts.resultPassed);

  /** `false`, когда ни одна строка источника подойти не может — фильтр исключил его целиком. */
  const NOTHING = sql`false`;

  const webWhere = and(
    ...(allowed ? [inArray(attempts.testId, allowed)] : []),
    ...(filter.from ? [gte(attempts.startedAt, filter.from)] : []),
    ...(filter.to ? [lte(attempts.startedAt, filter.to)] : []),
    ...(outcomes ? [inArray(webOutcome, outcomes)] : []),
    // Группа веб-попытки выводится из членства пользователя — это отдельный разрез (FR-06).
    // Пока фильтр по группе отбирает только строки, которым группу проставил импорт.
    ...(filter.groupIds?.length ? [NOTHING] : []),
    ...(sources && !sources.includes("web") ? [NOTHING] : []),
    ...(impossible ? [NOTHING] : []),
  );

  const lmsOrigins = (sources ?? ["telemetry", "import"]).filter(
    (s): s is "telemetry" | "import" => s !== "web",
  );
  const lmsWhere = and(
    ...(allowed ? [inArray(scormAttempts.testId, allowed)] : []),
    ...(filter.from ? [gte(scormAttempts.startedAt, filter.from)] : []),
    ...(filter.to ? [lte(scormAttempts.startedAt, filter.to)] : []),
    ...(filter.groupIds?.length ? [inArray(scormAttempts.groupId, filter.groupIds)] : []),
    ...(outcomes ? [inArray(lmsOutcome, outcomes)] : []),
    ...(lmsOrigins.length ? [inArray(scormAttempts.origin, lmsOrigins)] : [NOTHING]),
    ...(impossible ? [NOTHING] : []),
  );

  const webQuery = db
    .select({ id: attempts.id, source: sql<string>`'web'`, startedAt: attempts.startedAt })
    .from(attempts)
    .leftJoin(tests, eq(tests.id, attempts.testId))
    .where(webWhere);

  const lmsQuery = db
    .select({ id: scormAttempts.id, source: scormAttempts.origin, startedAt: scormAttempts.startedAt })
    .from(scormAttempts)
    .leftJoin(tests, eq(tests.id, scormAttempts.testId))
    .where(lmsWhere);

  // Порядок обязан быть устойчивым: реестр догружается порциями (FR-01c), и у прохождений
  // одной секунды без второго ключа нет определённого места. Сортировка задана НОМЕРАМИ
  // колонок — единственный способ сослаться на колонку объединения, у которой нет своей
  // таблицы.
  const ordered = unionAll(webQuery, lmsQuery).orderBy(sql`3 desc`, sql`1 desc`);
  const limited = filter.limit === undefined ? ordered : ordered.limit(filter.limit);
  const keysQuery: PromiseLike<Array<{ id: string; source: string }>> =
    filter.offset ? limited.offset(filter.offset) : limited;

  // Счёт идёт отдельными запросами, а не длиной страницы: «показано 25 из 128» обязано
  // говорить про всю выборку, а не про порцию.
  const [keys, webTotal, lmsTotal] = await Promise.all([
    keysQuery,
    countOf(db.select({ n: sql<number>`count(*)::int` }).from(attempts)
      .leftJoin(tests, eq(tests.id, attempts.testId)).where(webWhere)),
    countOf(db.select({ n: sql<number>`count(*)::int` }).from(scormAttempts)
      .leftJoin(tests, eq(tests.id, scormAttempts.testId)).where(lmsWhere)),
  ]);

  return { rows: await hydrate(keys), total: webTotal + lmsTotal };
}

/** Развернуть запрос-счётчик в число. */
async function countOf(query: PromiseLike<Array<{ n: number }>>): Promise<number> {
  const rows = await query;
  return rows[0]?.n ?? 0;
}

/** Дочитать выбранные строки и привести их к наблюдениям. */
async function hydrate(keys: Array<{ id: string; source: string }>): Promise<Observation[]> {
  if (keys.length === 0) return [];
  const webIds = keys.filter(k => k.source === "web").map(k => k.id);
  const lmsIds = keys.filter(k => k.source !== "web").map(k => k.id);

  const [webRows, lmsRows] = await Promise.all([
    webIds.length ? db.select().from(attempts).where(inArray(attempts.id, webIds)) : [],
    lmsIds.length ? db.select().from(scormAttempts).where(inArray(scormAttempts.id, lmsIds)) : [],
  ]);

  const testIds = [...new Set([
    ...webRows.map(r => r.testId),
    ...lmsRows.map(r => r.testId).filter((id): id is string => !!id),
  ])];
  const testRows = testIds.length
    ? await db.select().from(tests).where(inArray(tests.id, testIds))
    : [];
  const graded = new Map(testRows.map(t => [t.id, declaresThreshold(t.overallPassRuleJson)]));

  const userIds = [...new Set(webRows.map(r => r.userId).concat(
    lmsRows.map(r => r.userId).filter((id): id is string => !!id),
  ))];
  const userRows = userIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const users = new Map(userRows.map(u => [u.id, { name: u.name }]));

  const byId = new Map<string, Observation>();
  for (const row of webRows) {
    byId.set(row.id, toObservation.web(row, { users, gradedTest: graded.get(row.testId) }));
  }
  for (const row of lmsRows) {
    byId.set(row.id, toObservation.lms(row, {
      users,
      packages: new Map(),
      gradedTest: row.testId ? graded.get(row.testId) : undefined,
    }));
  }
  return keys.map(k => byId.get(k.id)).filter((o): o is Observation => !!o);
}

/** Объявляет ли тест проходной балл. Половина правила PRD-29 §6.7, относящаяся к тесту. */
function declaresThreshold(rule: unknown): boolean | undefined {
  if (rule === null || rule === undefined) return undefined;
  const type = (rule as { type?: string }).type;
  return type !== undefined && type !== "none";
}
