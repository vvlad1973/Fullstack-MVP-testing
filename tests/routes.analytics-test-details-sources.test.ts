/**
 * @module tests/routes.analytics-test-details-sources
 * @description PRD-56 FR-25: экран теста считает ВСЕ свои блоки по всем источникам.
 *
 * Плитки перевели на слой наблюдений первыми, и на живом экране стало видно расхождение
 * внутри одной страницы: «18 прохождений» в плитке и гистограмма, построенная по пятнадцати
 * веб-попыткам. Распределение и динамика не требуют ответов на вопросы — только процент и
 * даты, — поэтому считаются оттуда же, откуда плитки.
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
    getTest: vi.fn(), getTopics: vi.fn(), getQuestionsByIds: vi.fn(),
    getAllAttempts: vi.fn(), getAllScormAttempts: vi.fn(), getScormPackages: vi.fn(),
    getTestSections: vi.fn(), getTestQuestionScoring: vi.fn(),
    getScales: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getSnapshotsForTest: vi.fn().mockResolvedValue([]),
    selectObservations: vi.fn(), selectAnswersForTest: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import testDetailsRouter from "../server/routes/analytics/test-details";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics/tests", testDetailsRouter);
  return app;
}

const recently = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "u1", name: "Морозова Анна", email: "a@b.c" });
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTopics.mockResolvedValue([]);
  storageMock.getQuestionsByIds.mockResolvedValue([]);
  storageMock.getTestSections.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.selectAnswersForTest.mockResolvedValue([]);
  storageMock.getAllAttempts.mockResolvedValue([{
    id: "web-1", testId: "test1", userId: "u1",
    startedAt: recently(2), finishedAt: recently(2),
    variantJson: { sections: [] }, answersJson: {},
    resultJson: { overallPercent: 25, overallPassed: false, totalPossiblePoints: 20, totalEarnedPoints: 5 },
  }]);
  storageMock.getAllScormAttempts.mockResolvedValue([{
    id: "lms-1", testId: "test1", packageId: null, origin: "telemetry",
    userId: null, participantKey: null, groupId: null, lmsUserId: "lms-1", lmsUserName: "Пётр",
    startedAt: recently(1), finishedAt: recently(1),
    resultPercent: 95, resultPassed: true, maxPoints: 20, totalPoints: 19,
  }]);
});

describe("GET /api/analytics/tests/:testId — блоки экрана", () => {
  it("строит распределение результатов по всем источникам", async () => {
    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    expect(res.status).toBe(200);
    const byRange = Object.fromEntries(
      res.body.scoreDistribution.map((r: { range: string; count: number }) => [r.range, r.count]),
    );
    expect(byRange["21-30"]).toBe(1);
    expect(byRange["91-100"]).toBe(1);
  });

  it("строит динамику по всем источникам", async () => {
    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    const total = res.body.dailyTrends.reduce((sum: number, d: { attempts: number }) => sum + d.attempts, 0);
    expect(total).toBe(2);
  });

  it("считает статистику вопроса по ответам обоих источников", async () => {
    // Веб ответил верно, LMS — неверно. Пока страница читала одни веб-попытки, у вопроса
    // значилось «100 % верных» — при том, что половина отвечавших ошиблась.
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", prompt: "Вопрос", type: "single", topicId: "t1", difficulty: 50,
        optionsJson: ["а", "б"], correctJson: { correctIndex: 0 } },
    ]);
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "web-1", testId: "test1", userId: "u1",
      startedAt: recently(2), finishedAt: recently(2),
      variantJson: { sections: [{ questionIds: ["q1"] }] },
      answersJson: { q1: 0 },
      resultJson: { overallPercent: 100, overallPassed: true, totalPossiblePoints: 20, totalEarnedPoints: 20 },
    }]);
    storageMock.selectAnswersForTest.mockResolvedValue([
      { questionId: "q1", result: "incorrect", latencyMs: 42_000, origin: "telemetry" },
    ]);

    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    const question = res.body.questionStats.find((q: { questionId: string }) => q.questionId === "q1");
    expect(question).toMatchObject({ totalAnswers: 2, correctAnswers: 1, correctPercent: 50 });
  });

  it("не теряет вопрос, который встречался только в прохождениях из LMS", async () => {
    // Набор вопросов собирался из вариантов веб-попыток: заданий, выданных только в пакете,
    // в нём нет — и их ответы отбрасывались молча.
    storageMock.getQuestionsByIds.mockImplementation(async (ids: string[]) =>
      ids.map(id => ({
        id, prompt: "Вопрос " + id, type: "single", topicId: "t1", difficulty: 50,
        optionsJson: ["а", "б"], correctJson: { correctIndex: 0 },
      })));
    storageMock.selectAnswersForTest.mockResolvedValue([
      { questionId: "only-lms", result: "correct", latencyMs: null, origin: "import" },
    ]);

    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    expect(res.body.questionStats.map((q: { questionId: string }) => q.questionId))
      .toContain("only-lms");
  });

  it("не считает измерительный ответ ни верным, ни неверным", async () => {
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", prompt: "Шкальный", type: "scale", topicId: "t1", difficulty: 50 },
    ]);
    storageMock.selectAnswersForTest.mockResolvedValue([
      { questionId: "q1", result: "neutral", latencyMs: null, origin: "telemetry" },
      { questionId: "q1", result: "neutral", latencyMs: null, origin: "telemetry" },
    ]);

    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    const question = res.body.questionStats.find((q: { questionId: string }) => q.questionId === "q1");
    // Доля верных у опросника не «ноль», а «неприменимо»: эталона у него нет (PRD-26 FR-08).
    expect(question).toMatchObject({ totalAnswers: 2, gradedAnswers: 0, correctPercent: null });
  });
});
