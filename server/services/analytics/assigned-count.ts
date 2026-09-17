/**
 * @module server/services/analytics/assigned-count
 * @description PRD-56 FR-06: сколько людей среза получили назначение теста.
 *
 * Величина отвечает на «сколько позвали» и стоит рядом с «сколько начали»: без неё срез
 * рассказывает только про пришедших и молчит про тех, кого позвали, а они не явились.
 *
 * Считается НЕ у всякого среза, и это принципиально. Назначение существует до прохождения и
 * относится к ЧЕЛОВЕКУ, а срез бывает построен по свойству ПОПЫТКИ — номеру, варианту выдачи,
 * версии публикации, источнику. «Сколько назначено второй попытке» не значит ничего: назначают
 * не попытку. Там, где величина неприменима, читатель отвечает `null`, а экран рисует прочерк
 * (FR-27): выдумать для неё число значило бы показать величину, которую нельзя истолковать
 * (FR-29).
 */

import { storage } from "../../storage";

/** Готовый справочник назначений теста: счёт по срезам без новых запросов. */
export interface AssignedReader {
  /**
   * Сколько участников среза получили назначение.
   *
   * @param groupIds группы, которыми описан срез: пустой список — срез без условий («тест
   *   целиком»), и тогда считаются все назначенные. `null` — срез описан не группами, и
   *   величина к нему неприменима.
   */
  countFor(groupIds: readonly string[] | null): number | null;
}

/**
 * Прочитать назначения теста и членство всех групп, которые в них участвуют.
 *
 * Членство групп СРЕЗОВ дочитывается тоже: срез может ссылаться на группу, которой тест не
 * назначали вовсе, и её участники должны дать честный ноль, а не остаться непосчитанными.
 *
 * @param testId тест — рамка расчёта
 * @param sliceGroupIds группы, встречающиеся в срезах этого запроса
 */
export async function readAssigned(
  testId: string,
  sliceGroupIds: readonly string[] = [],
): Promise<AssignedReader> {
  const assignments = await storage.getTestAssignments(testId);

  const needed = new Set<string>(sliceGroupIds);
  for (const assignment of assignments) {
    if (assignment.groupId) needed.add(assignment.groupId);
  }

  const membersOfGroup = new Map<string, string[]>(
    await Promise.all([...needed].map(async id => [
      id,
      (await storage.getGroupUsers(id)).map(user => user.id),
    ] as const)),
  );

  // Назначение группе — это назначение каждому её участнику: человек, попавший в срез, должен
  // считаться назначенным независимо от того, позвали его поимённо или списком.
  const assignedUsers = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.userId) assignedUsers.add(assignment.userId);
    if (assignment.groupId) {
      for (const userId of membersOfGroup.get(assignment.groupId) ?? []) assignedUsers.add(userId);
    }
  }

  return {
    countFor(groupIds) {
      if (groupIds === null) return null;
      if (groupIds.length === 0) return assignedUsers.size;

      const inSlice = new Set<string>();
      for (const groupId of groupIds) {
        for (const userId of membersOfGroup.get(groupId) ?? []) inSlice.add(userId);
      }
      let count = 0;
      for (const userId of inSlice) if (assignedUsers.has(userId)) count += 1;
      return count;
    },
  };
}
