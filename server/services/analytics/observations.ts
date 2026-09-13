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

import { hasPronouncedVerdict, nothingToGrade } from "@shared/scoring/pass-rule";

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
