/**
 * @module tests/routes.analytics-attention
 * @description PRD-56 FR-10, FR-11: ручка очереди «требует внимания».
 *
 * Правила отбора проверены на сервисе; здесь — то, что относится к ручке: область видимости,
 * подпись теста и счётчики рядом с позициями.
 */
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { observationsDouble } from "./helpers/observations-double";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTests: vi.fn(), getTest: vi.fn(),
    getAllAssignments: vi.fn(),
    getAllAttempts: vi.fn(), getAllScormAttempts: vi.fn(), getScormPackages: vi.fn(),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    selectObservations: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import attentionRouter from "../server/routes/analytics/attention";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard", maxAttempts: 3,
  overallPassRuleJson: { type: "percent", value: 70 },
};
const OTHER_TEST = { ...TEST, id: "test2", title: "Чужой тест" };

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", attentionRouter);
  return app;
}

const ask = () => request(makeApp()).get("/api/analytics/attention").set("x-test-user", "a1");

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "u2", name: "Сафин Ильдар", email: "s@b.c" });
  storageMock.getTests.mockResolvedValue([TEST, OTHER_TEST]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.getAllAttempts.mockResolvedValue([]);
  storageMock.getAllScormAttempts.mockResolvedValue([]);
  storageMock.getAllAssignments.mockResolvedValue([]);
});

describe("GET /api/analytics/attention", () => {
  it("собирает просроченные назначения и подписывает тест", async () => {
    storageMock.getAllAssignments.mockResolvedValue([
      { id: "a1", testId: "test1", userId: "u2", groupId: null, dueDate: daysAgo(3) },
    ]);

    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      kind: "overdue",
      participant: "Сафин Ильдар",
      testTitle: "Сертификация",
    });
    expect(res.body.counts.overdue).toBe(1);
  });

  it("не показывает дела по тестам вне области видимости", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test1"]);
    storageMock.getAllAssignments.mockResolvedValue([
      { id: "a1", testId: "test1", userId: "u2", groupId: null, dueDate: daysAgo(3) },
      { id: "a2", testId: "test2", userId: "u2", groupId: null, dueDate: daysAgo(3) },
    ]);

    const res = await ask();

    expect(res.body.items.map((item: { testId: string }) => item.testId)).toEqual(["test1"]);
  });

  it("ставит в очередь не сдавшего и считает его в своей корзине", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "web-1", testId: "test1", userId: "u1",
      startedAt: daysAgo(5), finishedAt: daysAgo(5),
      variantJson: {}, answersJson: {},
      resultJson: { overallPercent: 40, overallPassed: false, totalPossiblePoints: 20, totalEarnedPoints: 8 },
    }]);

    const res = await ask();

    expect(res.body.counts).toMatchObject({ failed: 1, overdue: 0 });
    expect(res.body.items[0].observationId).toBe("web-1");
  });

  it("отвечает пустой очередью, когда дел нет", async () => {
    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.counts).toEqual({ overdue: 0, failed: 0, abandoned: 0, exhausted: 0 });
  });
});
