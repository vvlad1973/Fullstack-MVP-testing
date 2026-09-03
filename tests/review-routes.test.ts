/**
 * @module tests/review-routes
 *
 * PRD-52 FR-18..FR-26: API комментариев рецензирования. Проверяются правила
 * жизненного цикла, которые больше нигде не живут: ответ ровно одного уровня,
 * исход только у корня и только от того, кто может править тест, обязательный
 * ответ при отклонении, удаление только своего и только пока не ответили, и
 * пометки «изменено после комментария» / «объект удалён» при чтении.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import { ROLES } from "@shared/access";

vi.hoisted(() => { process.env.DATABASE_URL = "postgresql://fake/test"; });

const { storageMock, accessMock, anchorMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    getTest: vi.fn(),
    getTestGrantForUser: vi.fn(),
    listReviewThreads: vi.fn(),
    getReviewComment: vi.fn(),
    hasReviewReplies: vi.fn(),
    createReviewComment: vi.fn(),
    updateReviewCommentBody: vi.fn(),
    deleteReviewComment: vi.fn(),
    resolveReviewComment: vi.fn(),
    reopenReviewComment: vi.fn(),
  },
  accessMock: { canReviewTest: vi.fn(), canEditTest: vi.fn() },
  anchorMock: { describeAnchor: vi.fn(), isAnchorStale: vi.fn(), isAnchorOrphaned: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/test-access", () => accessMock);
vi.mock("../server/services/review-anchor", () => anchorMock);
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import reviewRouter from "../server/routes/review";

const TEST = { id: "t1", ownerId: "author-1" };

/** Приложение с сессией фиксированного пользователя. */
function makeApp(userId: string) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.session.userId = userId; next(); });
  app.use("/api/tests", reviewRouter);
  return app;
}

const expertApp = () => makeApp("expert-1");
const authorApp = () => makeApp("author-1");

/** Корень ветки от эксперта. */
function root(over: Record<string, unknown> = {}) {
  return {
    id: "c1", testId: "t1", authorId: "expert-1", parentId: null,
    body: "Формулировка допускает два прочтения",
    anchorKind: "question", questionId: "q1", topicId: "tp1", contentPageId: null,
    contextLabel: "Раздел «О компании» · Вопрос «…»",
    pinnedContentHash: "a".repeat(64),
    status: "open", resolvedBy: null, resolvedAt: null,
    createdAt: new Date("2026-09-02T14:20:00Z"), updatedAt: new Date("2026-09-02T14:20:00Z"),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockImplementation(async (id: string) => ({ id, status: "active", email: `${id}@x` }));
  storageMock.getUserRoles.mockResolvedValue([ROLES.AUTHOR]);
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTestGrantForUser.mockResolvedValue(undefined);
  storageMock.listReviewThreads.mockResolvedValue([{ ...root(), replies: [] }]);
  storageMock.getReviewComment.mockResolvedValue(root());
  storageMock.hasReviewReplies.mockResolvedValue(false);
  storageMock.createReviewComment.mockImplementation(async (input: Record<string, unknown>) => root(input));
  storageMock.updateReviewCommentBody.mockImplementation(async (_id: string, body: string) => root({ body }));
  storageMock.deleteReviewComment.mockResolvedValue(true);
  storageMock.resolveReviewComment.mockImplementation(
    async (_id: string, outcome: Record<string, unknown>) => root(outcome),
  );
  storageMock.reopenReviewComment.mockResolvedValue(root({ status: "open" }));
  accessMock.canReviewTest.mockResolvedValue(true);
  accessMock.canEditTest.mockImplementation(async (_r: unknown, userId: string) => userId === "author-1");
  anchorMock.describeAnchor.mockResolvedValue({
    contextLabel: "Раздел «О компании» · Вопрос «…»", pinnedContentHash: "a".repeat(64),
  });
  anchorMock.isAnchorStale.mockResolvedValue(false);
  anchorMock.isAnchorOrphaned.mockResolvedValue(false);
});

describe("GET /:id/review/comments", () => {
  it("отдаёт ветки рецензенту", async () => {
    const res = await request(expertApp()).get("/api/tests/t1/review/comments");
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe("c1");
  });

  it("помечает ветку изменённой, когда содержимое разошлось с пином", async () => {
    anchorMock.isAnchorStale.mockResolvedValue(true);
    const res = await request(expertApp()).get("/api/tests/t1/review/comments");
    expect(res.body[0].stale).toBe(true);
  });

  it("помечает ветку осиротевшей, когда объект якоря удалён", async () => {
    anchorMock.isAnchorOrphaned.mockResolvedValue(true);
    const res = await request(expertApp()).get("/api/tests/t1/review/comments");
    expect(res.body[0].orphaned).toBe(true);
  });

  it("посторонний получает 403", async () => {
    accessMock.canReviewTest.mockResolvedValue(false);
    const res = await request(makeApp("stranger")).get("/api/tests/t1/review/comments");
    expect(res.status).toBe(403);
  });
});

describe("POST /:id/review/comments", () => {
  it("подставляет ярлык и пин по якорю", async () => {
    const res = await request(expertApp())
      .post("/api/tests/t1/review/comments")
      .send({ body: "Криво", anchor: { kind: "question", questionId: "q1" } });
    expect(res.status).toBe(201);
    expect(storageMock.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({
        contextLabel: "Раздел «О компании» · Вопрос «…»",
        pinnedContentHash: "a".repeat(64),
        authorId: "expert-1",
      }),
    );
  });

  it("ответ цепляется к корню и не несёт своего якоря", async () => {
    const res = await request(expertApp())
      .post("/api/tests/t1/review/comments")
      .send({ body: "Согласен", parentId: "c1" });
    expect(res.status).toBe(201);
    expect(storageMock.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: "c1" }),
    );
  });

  it("ответ на ответ отвергается: ветка ровно одного уровня", async () => {
    storageMock.getReviewComment.mockResolvedValue(root({ id: "r1", parentId: "c1" }));
    const res = await request(expertApp())
      .post("/api/tests/t1/review/comments")
      .send({ body: "Ещё", parentId: "r1" });
    expect(res.status).toBe(422);
    expect(storageMock.createReviewComment).not.toHaveBeenCalled();
  });

  it("пустой текст не проходит", async () => {
    const res = await request(expertApp())
      .post("/api/tests/t1/review/comments")
      .send({ body: "   ", anchor: { kind: "test" } });
    expect(res.status).toBe(400);
  });
});

describe("PATCH и DELETE — правка своего", () => {
  it("автор комментария правит свой текст", async () => {
    const res = await request(expertApp())
      .patch("/api/tests/t1/review/comments/c1")
      .send({ body: "Уточняю" });
    expect(res.status).toBe(200);
    expect(storageMock.updateReviewCommentBody).toHaveBeenCalledWith("c1", "Уточняю");
  });

  it("чужой комментарий не правится даже владельцем теста", async () => {
    const res = await request(authorApp())
      .patch("/api/tests/t1/review/comments/c1")
      .send({ body: "Перепишу за эксперта" });
    expect(res.status).toBe(403);
  });

  it("после ответа свой комментарий уже не правится", async () => {
    storageMock.hasReviewReplies.mockResolvedValue(true);
    const res = await request(expertApp())
      .patch("/api/tests/t1/review/comments/c1")
      .send({ body: "Поздно" });
    expect(res.status).toBe(409);
  });

  it("свой комментарий удаляется, пока на него не ответили", async () => {
    const res = await request(expertApp()).delete("/api/tests/t1/review/comments/c1");
    expect(res.status).toBe(200);
    expect(storageMock.deleteReviewComment).toHaveBeenCalledWith("c1");
  });

  it("чужой комментарий не удаляет никто, включая владельца теста", async () => {
    const res = await request(authorApp()).delete("/api/tests/t1/review/comments/c1");
    expect(res.status).toBe(403);
    expect(storageMock.deleteReviewComment).not.toHaveBeenCalled();
  });

  it("после ответа свой комментарий не удаляется", async () => {
    storageMock.hasReviewReplies.mockResolvedValue(true);
    const res = await request(expertApp()).delete("/api/tests/t1/review/comments/c1");
    expect(res.status).toBe(409);
  });
});

describe("исход ветки", () => {
  it("отклонение без ответа не проходит", async () => {
    const res = await request(authorApp())
      .post("/api/tests/t1/review/comments/c1/resolve")
      .send({ status: "rejected" });
    expect(res.status).toBe(422);
    expect(storageMock.resolveReviewComment).not.toHaveBeenCalled();
  });

  it("отклонение с ответом в ветке закрывает её", async () => {
    storageMock.hasReviewReplies.mockResolvedValue(true);
    const res = await request(authorApp())
      .post("/api/tests/t1/review/comments/c1/resolve")
      .send({ status: "rejected" });
    expect(res.status).toBe(200);
    expect(storageMock.resolveReviewComment).toHaveBeenCalledWith("c1", {
      status: "rejected", resolvedBy: "author-1",
    });
  });

  it("«учтено» ответа не требует", async () => {
    const res = await request(authorApp())
      .post("/api/tests/t1/review/comments/c1/resolve")
      .send({ status: "accepted" });
    expect(res.status).toBe(200);
  });

  it("рецензент закрыть ветку не может", async () => {
    const res = await request(expertApp())
      .post("/api/tests/t1/review/comments/c1/resolve")
      .send({ status: "accepted" });
    expect(res.status).toBe(403);
  });

  it("исход ставится только на корень ветки", async () => {
    storageMock.getReviewComment.mockResolvedValue(root({ id: "r1", parentId: "c1", status: null }));
    const res = await request(authorApp())
      .post("/api/tests/t1/review/comments/r1/resolve")
      .send({ status: "accepted" });
    expect(res.status).toBe(422);
  });

  it("закрытая ветка открывается заново", async () => {
    storageMock.getReviewComment.mockResolvedValue(root({ status: "accepted" }));
    const res = await request(authorApp()).post("/api/tests/t1/review/comments/c1/reopen");
    expect(res.status).toBe(200);
    expect(storageMock.reopenReviewComment).toHaveBeenCalledWith("c1");
  });

  it("комментарий чужого теста не трогается через свой", async () => {
    storageMock.getReviewComment.mockResolvedValue(root({ testId: "other" }));
    const res = await request(authorApp())
      .post("/api/tests/t1/review/comments/c1/resolve")
      .send({ status: "accepted" });
    expect(res.status).toBe(404);
  });
});
