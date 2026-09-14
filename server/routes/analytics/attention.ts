/**
 * @module server/routes/analytics/attention
 * @description PRD-56 FR-10, FR-11: очередь «требует внимания».
 *
 * Ручка собирает то, по чему есть действие: просроченные назначения, не сдавших, брошенные
 * попытки и исчерпавших лимит. Правила отбора живут в сервисе — здесь только сбор данных и
 * область видимости читателя.
 */
import { Router, type Request, type Response } from "express";

import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { storage } from "../../storage";
import {
  buildAttentionQueue,
  countAttention,
  type AttentionItem,
} from "../../services/analytics/attention";
import { loadObservations } from "../../services/analytics/observations";
import { analyticsScope } from "./helpers";

const router = Router();

/** Имя участника по его идентификатору — для позиций, у которых прохождения ещё нет. */
async function namesOf(userIds: string[]): Promise<Map<string, string>> {
  const rows = await Promise.all([...new Set(userIds)].map(id => storage.getUser(id)));
  return new Map(
    rows
      .filter((user): user is NonNullable<typeof user> => !!user)
      .map(user => [user.id, user.name || user.email || "Участник"]),
  );
}

// GET /api/analytics/attention — дела, требующие вмешательства
router.get("/attention", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const scope = await analyticsScope(req);

    const [{ rows: observations }, assignments, tests] = await Promise.all([
      // Очередь смотрит на ВСЕ прохождения области видимости: лимит здесь неуместен —
      // «показать первые 25 дел» означало бы, что о двадцать шестом никто не узнает.
      loadObservations({}, scope),
      storage.getAllAssignments(),
      storage.getTests(),
    ]);

    const visible = tests.filter(test => scope.all || scope.ids.has(test.id));
    const visibleIds = new Set(visible.map(test => test.id));
    const attemptLimits = new Map(visible.map(test => [test.id, test.maxAttempts ?? null]));

    const scopedAssignments = assignments
      .filter(assignment => visibleIds.has(assignment.testId))
      .map(assignment => ({
        id: assignment.id,
        testId: assignment.testId,
        userId: assignment.userId,
        dueDate: assignment.dueDate,
      }));

    const participantNames = await namesOf(
      scopedAssignments
        .map(assignment => assignment.userId)
        .filter((id): id is string => !!id),
    );

    const items = buildAttentionQueue({
      assignments: scopedAssignments,
      observations,
      attemptLimits,
      participantNames,
      now: new Date(),
    });

    const titles = new Map(visible.map(test => [test.id, test.title]));
    res.json({
      counts: countAttention(items),
      items: items.map((item: AttentionItem) => ({
        ...item,
        // Тест мог быть удалён: дело от этого не перестаёт существовать.
        testTitle: item.testId ? titles.get(item.testId) ?? "Удалённый тест" : "Удалённый тест",
      })),
    });
  } catch (error) {
    logger.error("Attention queue error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to build attention queue" });
  }
});

export default router;
