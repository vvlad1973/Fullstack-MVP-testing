/**
 * @module routes/review
 * @description PRD-52 — API рецензирования теста: комментарии и их жизненный цикл.
 *
 * Доступ на ЧТЕНИЕ и на СОЗДАНИЕ комментария даёт `requireReviewScope` — грант
 * `review` на этом тесте или уже имеющийся edit-доступ. Роль здесь не проверяется
 * сознательно: внешний рецензент приходит по ссылке с ролью `learner`, и гейт по
 * capability закрыл бы дверь ровно перед той аудиторией, ради которой всё сделано.
 *
 * ЗАКРЫТИЕ ветки с исходом — наоборот, действие автора теста, поэтому оно идёт под
 * edit-скоупом. Рецензент видит уже проставленный исход, но поставить его не может:
 * «учтено» означает обещание правки, а правит тест автор.
 *
 * Правила ветки, которые держит этот роутер (FR-21..FR-25):
 *   - ответ ровно одного уровня: ответ на ответ отвергается;
 *   - исход живёт только на корне;
 *   - при отклонении в ветке обязан быть ответ — отказ без объяснения не проходит;
 *   - править и удалять можно только СВОЙ комментарий и только пока не ответили;
 *   - чужой комментарий не удаляет никто, включая владельца теста: история приёмки
 *     не должна редактироваться задним числом.
 */
import { Router, type Request, type Response } from "express";
import { requireUserContext, requirePermission } from "../middleware/auth";
import { requireReviewScope } from "../middleware/review-scope";
import { requireTestScope } from "../middleware/test-scope";
import { storage } from "../storage";
import { describeAnchor, isAnchorStale, isAnchorOrphaned } from "../services/review-anchor";
import type { ReviewAnchor, ReviewAnchorKind } from "@shared/review/anchor";
import { logger } from "../logger";

const router = Router();

/** Чтение и создание — по ревью-скоупу. */
const reviewGate = [requireUserContext, requireReviewScope()];
/** Исход ветки — по edit-скоупу теста. */
const resolveGate = [requirePermission("tests.edit"), requireTestScope("edit")];

const ANCHOR_KINDS: ReviewAnchorKind[] = [
  "question", "content-page", "topic", "start", "results", "test",
];

/** Предел длины комментария: поле ввода, а не документ. */
const BODY_MAX = 4000;

/** Разбирает якорь из запроса; `null` — якорь не задан или задан неверно. */
function parseAnchor(raw: unknown): ReviewAnchor | null {
  if (!raw || typeof raw !== "object") return null;
  const anchor = raw as Record<string, unknown>;
  const kind = anchor.kind;
  if (typeof kind !== "string" || !ANCHOR_KINDS.includes(kind as ReviewAnchorKind)) return null;
  return {
    kind: kind as ReviewAnchorKind,
    questionId: typeof anchor.questionId === "string" ? anchor.questionId : null,
    topicId: typeof anchor.topicId === "string" ? anchor.topicId : null,
    contentPageId: typeof anchor.contentPageId === "string" ? anchor.contentPageId : null,
  };
}

/** Якорь ветки — то, по чему считаются пометки устаревания и осиротелости. */
function anchorOf(row: {
  anchorKind: string; questionId: string | null; topicId: string | null; contentPageId: string | null;
}): ReviewAnchor {
  return {
    kind: row.anchorKind as ReviewAnchorKind,
    questionId: row.questionId,
    topicId: row.topicId,
    contentPageId: row.contentPageId,
  };
}

// GET /api/tests/:id/review/comments — ветки теста с пометками состояния якоря.
router.get("/:id/review/comments", ...reviewGate, async (req: Request, res: Response) => {
  try {
    const threads = await storage.listReviewThreads(req.params.id);
    const decorated = await Promise.all(
      threads.map(async (thread) => {
        const anchor = anchorOf(thread);
        const [stale, orphaned] = await Promise.all([
          isAnchorStale(anchor, thread.pinnedContentHash),
          isAnchorOrphaned(anchor),
        ]);
        // `stale` и `orphaned` НЕ хранятся: это состояние теста на момент чтения,
        // а не свойство комментария. Записанные, они разошлись бы с содержимым при
        // первой же правке в обход панели.
        return { ...thread, stale, orphaned };
      }),
    );
    res.json(decorated);
  } catch (error) {
    logger.error("Review comments read failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось прочитать комментарии" });
  }
});

// POST /api/tests/:id/review/comments — новый комментарий или ответ в ветке.
router.post("/:id/review/comments", ...reviewGate, async (req: Request, res: Response) => {
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) return res.status(400).json({ error: "Комментарий не может быть пустым" });
  if (body.length > BODY_MAX) return res.status(400).json({ error: "Комментарий слишком длинный" });

  const parentId = typeof req.body?.parentId === "string" ? req.body.parentId : null;
  try {
    if (parentId) {
      const parent = await storage.getReviewComment(parentId);
      if (!parent || parent.testId !== req.params.id) {
        return res.status(404).json({ error: "Комментарий не найден" });
      }
      if (parent.parentId) {
        return res.status(422).json({ error: "Ответить можно только на исходный комментарий" });
      }
      const created = await storage.createReviewComment({
        testId: req.params.id,
        authorId: req.currentUser!.id,
        parentId,
        body,
        // Ответ наследует якорь корня: он о том же месте, и своего якоря не имеет.
        anchorKind: parent.anchorKind,
        questionId: parent.questionId,
        topicId: parent.topicId,
        contentPageId: parent.contentPageId,
      });
      return res.status(201).json(created);
    }

    const anchor = parseAnchor(req.body?.anchor);
    if (!anchor) return res.status(400).json({ error: "Не указано место комментария" });
    const snapshot = await describeAnchor(anchor);
    const created = await storage.createReviewComment({
      testId: req.params.id,
      authorId: req.currentUser!.id,
      parentId: null,
      body,
      anchorKind: anchor.kind,
      questionId: anchor.questionId ?? null,
      topicId: anchor.topicId ?? null,
      contentPageId: anchor.contentPageId ?? null,
      contextLabel: snapshot.contextLabel,
      pinnedContentHash: snapshot.pinnedContentHash,
    });
    res.status(201).json(created);
  } catch (error) {
    logger.error("Review comment create failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось сохранить комментарий" });
  }
});

/**
 * Загружает комментарий этого теста и проверяет, что правит его АВТОР и что в ветке
 * ещё не отвечали. Возвращает `null`, если ответ уже отправлен вызывающему.
 */
async function loadOwnEditable(req: Request, res: Response) {
  const comment = await storage.getReviewComment(req.params.commentId);
  if (!comment || comment.testId !== req.params.id) {
    res.status(404).json({ error: "Комментарий не найден" });
    return null;
  }
  if (comment.authorId !== req.currentUser!.id) {
    res.status(403).json({ error: "Чужой комментарий" });
    return null;
  }
  if (await storage.hasReviewReplies(comment.id)) {
    res.status(409).json({ error: "В ветке уже есть ответ" });
    return null;
  }
  return comment;
}

// PATCH /api/tests/:id/review/comments/:commentId — правка собственного текста.
router.patch("/:id/review/comments/:commentId", ...reviewGate, async (req: Request, res: Response) => {
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) return res.status(400).json({ error: "Комментарий не может быть пустым" });
  try {
    if (!(await loadOwnEditable(req, res))) return;
    const updated = await storage.updateReviewCommentBody(req.params.commentId, body);
    res.json(updated);
  } catch (error) {
    logger.error("Review comment update failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось изменить комментарий" });
  }
});

// DELETE /api/tests/:id/review/comments/:commentId — удаление собственного.
router.delete("/:id/review/comments/:commentId", ...reviewGate, async (req: Request, res: Response) => {
  try {
    if (!(await loadOwnEditable(req, res))) return;
    res.json({ deleted: await storage.deleteReviewComment(req.params.commentId) });
  } catch (error) {
    logger.error("Review comment delete failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось удалить комментарий" });
  }
});

// POST /api/tests/:id/review/comments/:commentId/resolve — закрытие с исходом.
router.post("/:id/review/comments/:commentId/resolve", ...resolveGate, async (req: Request, res: Response) => {
  const status = req.body?.status;
  if (status !== "accepted" && status !== "rejected") {
    return res.status(400).json({ error: "Исход должен быть «учтено» или «отклонено»" });
  }
  try {
    const comment = await storage.getReviewComment(req.params.commentId);
    if (!comment || comment.testId !== req.params.id) {
      return res.status(404).json({ error: "Комментарий не найден" });
    }
    if (comment.parentId) {
      return res.status(422).json({ error: "Исход ставится на исходный комментарий, а не на ответ" });
    }
    if (status === "rejected" && !(await storage.hasReviewReplies(comment.id))) {
      // Отклонение без объяснения оставляет рецензента без ответа на вопрос
      // «почему»; ответ в ветке — и есть это объяснение.
      return res.status(422).json({ error: "При отклонении нужен ответ с объяснением" });
    }
    const resolved = await storage.resolveReviewComment(comment.id, {
      status,
      resolvedBy: req.currentUser!.id,
    });
    res.json(resolved);
  } catch (error) {
    logger.error("Review comment resolve failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось закрыть комментарий" });
  }
});

// POST /api/tests/:id/review/comments/:commentId/reopen — открыть заново.
router.post("/:id/review/comments/:commentId/reopen", ...resolveGate, async (req: Request, res: Response) => {
  try {
    const comment = await storage.getReviewComment(req.params.commentId);
    if (!comment || comment.testId !== req.params.id) {
      return res.status(404).json({ error: "Комментарий не найден" });
    }
    if (comment.parentId) {
      return res.status(422).json({ error: "Открыть заново можно исходный комментарий" });
    }
    res.json(await storage.reopenReviewComment(comment.id));
  } catch (error) {
    logger.error("Review comment reopen failed: " + (error as Error).message, "review");
    res.status(500).json({ error: "Не удалось открыть комментарий" });
  }
});

export default router;
