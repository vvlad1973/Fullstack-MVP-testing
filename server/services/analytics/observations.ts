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
 * Отбор и порция считаются запросом в DAL (`storage.selectObservations`); здесь живут правила
 * оценивания — что считать результатом, вердиктом и исходом.
 */

import { hasPronouncedVerdict, nothingToGrade } from "@shared/scoring/pass-rule";

import { storage } from "../../storage";
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
  /**
   * Чем опознаётся участник: пользователь, псевдоним импорта или идентификатор из LMS.
   * По нему считаются уникальные участники — иначе телеметрия без связи и без псевдонима
   * выглядела бы как ноль людей.
   */
  participantId: string | null;
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
  /** Набранные и достижимые баллы; `null`, когда оценивать было нечего. */
  earnedPoints: number | null;
  possiblePoints: number | null;
  outcome: ObservationOutcome;
  /**
   * Адаптивное прохождение (PRD-16): его результат — достигнутый уровень, а не доля верных.
   * Усреднять такой процент вместе с обычными значит складывать разные величины.
   */
  adaptive: boolean;
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
  totalPoints?: number | null;
  lmsUserId?: string | null;
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

/**
 * Достижимые баллы прохождения, если они записаны.
 *
 * `undefined` — «поля нет», и это не то же самое, что записанный ноль: ноль означает, что
 * оценивать было нечего (PRD-29 §6.7), а отсутствие поля — что запись старая либо источник
 * баллов не сообщает.
 */
function possiblePointsOf(result: unknown): number | undefined {
  const value = (result as { totalPossiblePoints?: unknown } | null)?.totalPossiblePoints;
  return typeof value === "number" ? value : undefined;
}

/**
 * Единицы оценивания прохождения: достижимые баллы, а где их не записали — сам факт
 * посчитанного процента. У теста без проходного балла не считается ни то, ни другое.
 *
 * @param possiblePoints достижимые баллы из строки
 * @param percent посчитанный процент, если он есть
 * @param gradedTest объявляет ли тест проходной балл
 */
function gradedUnits(
  possiblePoints: number | null | undefined,
  percent: number | null | undefined,
  gradedTest: boolean | undefined,
): number {
  // Записанные баллы — прямой ответ, включая ноль: он и означает «оценивать было нечего».
  if (possiblePoints !== null && possiblePoints !== undefined) return possiblePoints;
  if (gradedTest === false) return 0;
  return percent !== null && percent !== undefined ? 1 : 0;
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
    const result = row.resultJson as {
      overallPercent?: number;
      overallPassed?: boolean;
      totalEarnedPoints?: number;
      mode?: string;
    } | null;
    // Прохождение состоялось, если посчитан результат, даже когда отметка завершения не
    // проставлена: такие строки в базе есть, и терять их в «не завершено» — занижать выборку.
    const finished = row.finishedAt !== null || result !== null && result !== undefined;
    const possiblePoints = possiblePointsOf(result);
    // Процент — такой же признак оценивания, как баллы: часть записей не несёт
    // `totalPossiblePoints`, и требовать их значило бы выкинуть их результат из средних.
    // Но у теста без проходного балла ноль процентов не результат, а отсутствие оценивания
    // (PRD-29 §6.7), поэтому признак теста перевешивает содержимое строки.
    // Адаптивное прохождение судят подтверждённые уровни, а не доля баллов: вердикт у него
    // есть всегда, хотя процента может не быть вовсе (то же правило, что в `gradingOf`).
    const adaptive = result?.mode === "adaptive";
    const gradedPoints = gradedUnits(possiblePoints, result?.overallPercent, ctx.gradedTest);
    const scored = finished && (adaptive || !nothingToGrade(gradedPoints));
    const pronounced = finished && (adaptive || hasPronouncedVerdict(ctx.gradedTest, gradedPoints));
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
      participantId: row.userId,
      groupId: null,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: durationOf(row.startedAt, row.finishedAt),
      percent: scored ? result?.overallPercent ?? null : null,
      passed,
      earnedPoints: scored ? result?.totalEarnedPoints ?? null : null,
      possiblePoints: scored ? possiblePointsOf(result) ?? null : null,
      outcome: outcomeOf(finished, passed),
      adaptive,
      snapshotId: row.snapshotId ?? null,
      formId: (row.variantJson as { formId?: string } | null)?.formId ?? null,
    };
  },

  /** Прохождение из LMS: живая телеметрия или импортированная выгрузка (`scorm_attempts`). */
  lms(row: LmsAttemptRow, ctx: LmsObservationContext): Observation {
    // Телеметрия заводит строку при СТАРТЕ и обновляет по ходу, поэтому нули результата у
    // неё ничего не значат: признак завершения у этого источника один — отметка времени.
    const finished = row.finishedAt !== null && row.finishedAt !== undefined;
    // То же правило, что у веба: телеметрия не всегда сообщает `max_points`, и процент
    // остаётся признаком того, что оценивание было.
    const possiblePoints = gradedUnits(row.maxPoints, row.resultPercent, ctx.gradedTest);
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
      participantId: row.userId ?? row.participantKey ?? row.lmsUserId ?? null,
      groupId: row.groupId,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: durationOf(row.startedAt, row.finishedAt),
      percent: scored ? row.resultPercent ?? null : null,
      passed,
      earnedPoints: scored ? row.totalPoints ?? null : null,
      possiblePoints: scored ? possiblePoints : null,
      outcome: outcomeOf(finished, passed),
      // Режим прохождения телеметрия не сообщает: адаптивные разрезы считаются по вебу.
      adaptive: false,
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

  // Пересечение «что просили» и «что доступно» (FR-35). Пустой список означает, что доступного
  // нет вовсе, и выборка обязана вернуть ноль строк, а не всё подряд.
  const allowed = scope.all
    ? testIds
    : (testIds ?? [...scope.ids]).filter(id => scope.ids.has(id));

  const { web, lms, order, total } = await storage.selectObservations({
    testIds: allowed,
    groupIds: filter.groupIds,
    sources: filter.sources,
    outcomes: filter.outcomes,
    from: filter.from,
    to: filter.to,
    limit: filter.limit,
    offset: filter.offset,
    impossible: !scope.all && (allowed?.length ?? 0) === 0,
  });

  const rows = await normalise(web, lms);
  const byId = new Map(rows.map(o => [o.id, o]));
  return {
    rows: order.map(k => byId.get(k.id)).filter((o): o is Observation => !!o),
    total,
  };
}

/** Привести выбранные строки к наблюдениям, дочитав справочники теста и участников. */
async function normalise(
  web: Array<Parameters<typeof toObservation.web>[0] & { testId: string }>,
  lms: Array<Parameters<typeof toObservation.lms>[0]>,
): Promise<Observation[]> {
  if (web.length === 0 && lms.length === 0) return [];

  const testIds = new Set<string>([
    ...web.map(r => r.testId),
    ...lms.map(r => r.testId).filter((id): id is string => !!id),
  ]);
  // Тесты спрашиваются поимённо: выборка редко шире нескольких тестов, а чтение всего
  // справочника ради двух строк — то самое «загрузить таблицу целиком», от которого уходим.
  const testRows = await Promise.all([...testIds].map(id => storage.getTest(id)));
  const graded = new Map(
    testRows
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map(t => [t.id, declaresThreshold(t.overallPassRuleJson)]),
  );

  const userIds = new Set<string>([
    ...web.map(r => r.userId),
    ...lms.map(r => r.userId).filter((id): id is string => !!id),
  ]);
  const userRows = await Promise.all([...userIds].map(id => storage.getUser(id)));
  const users = new Map(
    userRows.filter((u): u is NonNullable<typeof u> => !!u).map(u => [u.id, { name: u.name }]),
  );

  // Пакет — запасной путь к тесту у строк телеметрии, которым backfill ничего не нашёл.
  const needsPackage = lms.some(r => !r.testId && r.packageId);
  const packages = needsPackage
    ? new Map((await storage.getScormPackages()).map(p => [p.id, { testId: p.testId }]))
    : new Map<string, { testId: string | null }>();

  return [
    ...web.map(row => toObservation.web(row, { users, gradedTest: graded.get(row.testId) })),
    ...lms.map(row => toObservation.lms(row, {
      users,
      packages,
      gradedTest: row.testId ? graded.get(row.testId) : undefined,
    })),
  ];
}

/** Объявляет ли тест проходной балл. Половина правила PRD-29 §6.7, относящаяся к тесту. */
function declaresThreshold(rule: unknown): boolean | undefined {
  if (rule === null || rule === undefined) return undefined;
  const type = (rule as { type?: string }).type;
  return type !== undefined && type !== "none";
}
