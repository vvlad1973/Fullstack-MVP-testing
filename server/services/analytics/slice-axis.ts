/**
 * @module server/services/analytics/slice-axis
 * @description PRD-56 FR-06a: ось разбиения — все срезы по одному признаку сразу.
 *
 * Срез отвечает на «покажи вот эту группу», ось — на «покажи мне все группы». Это разные
 * вопросы: первый задают, когда знают, кого искать, второй — когда ищут, где проблема.
 *
 * В объём входят только те оси, для которых данные УЖЕ есть. Оргструктуры в продукте нет (FR-06b):
 * у пользователя нет ни подразделения, ни должности, и разрезы по ним не появятся оттого, что их
 * очень хочется — это отдельная работа с полем профиля, формой и импортом.
 *
 * Модуль чистый: членство в группах, названия и признак внешнего участника приходят снаружи.
 */

import type { Observation } from "./observations";

/** Признак, по которому выборка разбивается на срезы. */
export type SliceAxis =
  /** Кого учили: членство участника, у импорта — метка группы. */
  | "group"
  /** Поток: календарный месяц начала прохождения. */
  | "period"
  /** Первая попытка против повторных: эффект пересдачи и следы утечки. */
  | "attempt"
  /** Версия публикации теста (PRD-15). */
  | "version"
  /** Вариант выдачи (PRD-17/24). */
  | "variant"
  /** Веб, телеметрия, импорт — разные популяции. */
  | "source"
  /** Внутренние сотрудники против внешних участников (PRD-28). */
  | "external";

/** Справочники, без которых ось не назвать человеческим языком. */
export interface AxisContext {
  /** Группы участника по его идентификатору — членство (`user_groups`). */
  groupsOfParticipant: ReadonlyMap<string, string[]>;
  groupNames: ReadonlyMap<string, string>;
  /** Участники, отмеченные внешними (`users.is_external`). */
  externalParticipants: ReadonlySet<string>;
  /** Номер версии публикации по идентификатору снимка. */
  snapshotVersions: ReadonlyMap<string, number>;
}

/** Один срез, полученный разбиением. */
export interface AxisBucket {
  key: string;
  label: string;
  observations: Observation[];
}

/** Ключ «ничего не проставлено» — у каждой оси он свой по смыслу, но всегда существует. */
const NONE = "none";

const SOURCE_LABEL: Record<string, string> = {
  web: "Веб",
  telemetry: "Телеметрия LMS",
  import: "Импорт",
};

/** Месяц начала в виде `ГГГГ-ММ` — по нему срезы сортируются как строки. */
function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Название месяца для человека: «сентябрь 2026». */
function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const names = [
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
  ];
  return `${names[Number(month) - 1] ?? month} ${year}`;
}

/**
 * Номер попытки участника: считается порядком по времени начала.
 *
 * `attempt_number` телеметрии тут не годится один: он нумерует попытки ВНУТРИ сессии пакета, а
 * ось спрашивает про человека — его первую попытку против повторных.
 */
function attemptNumbers(observations: readonly Observation[]): Map<string, number> {
  const byParticipant = new Map<string, Observation[]>();
  for (const observation of observations) {
    const key = observation.participantId ?? observation.id;
    const list = byParticipant.get(key) ?? [];
    list.push(observation);
    byParticipant.set(key, list);
  }

  const numbers = new Map<string, number>();
  for (const list of byParticipant.values()) {
    list
      .slice()
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .forEach((observation, index) => numbers.set(observation.id, index + 1));
  }
  return numbers;
}

/** Куда попадает прохождение по этой оси. Пусто — значит ни в один именованный срез. */
function keysOf(
  observation: Observation,
  axis: SliceAxis,
  context: AxisContext,
  attemptNumber: number,
): Array<{ key: string; label: string }> {
  switch (axis) {
    case "group": {
      // У импорта метка группы своя: участник там может быть не заведён вовсе (PRD-54).
      const ids = observation.groupId
        ? [observation.groupId]
        : context.groupsOfParticipant.get(observation.participantId ?? "") ?? [];
      if (ids.length === 0) return [{ key: NONE, label: "Без группы" }];
      return ids.map(id => ({ key: id, label: context.groupNames.get(id) ?? "Группа" }));
    }
    case "period": {
      const key = monthOf(observation.startedAt);
      return [{ key, label: monthLabel(key) }];
    }
    case "attempt": {
      if (attemptNumber === 1) return [{ key: "1", label: "Первая попытка" }];
      if (attemptNumber === 2) return [{ key: "2", label: "Вторая попытка" }];
      return [{ key: "3+", label: "Третья и далее" }];
    }
    case "version": {
      if (!observation.snapshotId) {
        // Прохождения из LMS версии пока не несут (FR-19a): молчать об этом нельзя — иначе
        // они слились бы с текущей версией и разрез начал бы врать.
        return [{ key: NONE, label: "Версия не указана" }];
      }
      const version = context.snapshotVersions.get(observation.snapshotId);
      return [{
        key: observation.snapshotId,
        label: version ? `Версия ${version}` : "Версия публикации",
      }];
    }
    case "variant": {
      return observation.formId
        ? [{ key: observation.formId, label: `Вариант ${observation.formId}` }]
        : [{ key: NONE, label: "Без варианта" }];
    }
    case "source": {
      return [{ key: observation.source, label: SOURCE_LABEL[observation.source] ?? observation.source }];
    }
    case "external": {
      const isExternal = context.externalParticipants.has(observation.participantId ?? "");
      return [isExternal
        ? { key: "external", label: "Внешние участники" }
        : { key: "internal", label: "Внутренние сотрудники" }];
    }
  }
}

/**
 * Разбить выборку на срезы по оси.
 *
 * Прохождение может попасть в НЕСКОЛЬКО срезов одной оси — участник состоит в двух группах, и
 * его результат честно виден в обеих. Сумма объёмов при этом больше выборки, и это правда о
 * данных, а не ошибка счёта.
 */
export function splitByAxis(
  observations: readonly Observation[],
  axis: SliceAxis,
  context: AxisContext,
): AxisBucket[] {
  const numbers = axis === "attempt" ? attemptNumbers(observations) : new Map<string, number>();
  const buckets = new Map<string, AxisBucket>();

  for (const observation of observations) {
    for (const { key, label } of keysOf(observation, axis, context, numbers.get(observation.id) ?? 1)) {
      const bucket = buckets.get(key) ?? { key, label, observations: [] };
      bucket.observations.push(observation);
      buckets.set(key, bucket);
    }
  }

  // Порядок устойчив и одинаков для всех осей — по ключу. У попыток он заодно осмысленный:
  // «1», «2», «3+» идут в том же порядке, в каком их читают.
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}
