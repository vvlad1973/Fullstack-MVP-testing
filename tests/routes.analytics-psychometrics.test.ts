/**
 * @module tests/routes.analytics-psychometrics
 * @description PRD-66 FR-56 - FR-58: ручка психометрики теста.
 *
 * Расчёт проверен на движке и на сведении; здесь — то, что относится к ручке: область
 * видимости, режим попыток по умолчанию, кэш и поведение на пустой выборке.
 */
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTest: vi.fn(),
    getTests: vi.fn().mockResolvedValue([]),
    getTestSections: vi.fn().mockResolvedValue([]),
    getQuestionsByTopic: vi.fn().mockResolvedValue([]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    getLmsImportBatches: vi.fn().mockResolvedValue([]),
    getSlices: vi.fn().mockResolvedValue([]),
    getQuestionsByIds: vi.fn().mockResolvedValue([]),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    getTestGrantForUser: vi.fn().mockResolvedValue(undefined),
    selectObservations: vi.fn().mockResolvedValue({ web: [], lms: [], order: [], total: 0 }),
    getAttemptsByIds: vi.fn().mockResolvedValue([]),
    selectAnswersForAttempts: vi.fn().mockResolvedValue([]),
    selectGroupsOfUsers: vi.fn().mockResolvedValue(new Map()),
    getSnapshot: vi.fn().mockResolvedValue(undefined),
    getScormPackages: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import psychometricsRouter, { resetPsychometricsCache } from "../server/routes/analytics/psychometrics";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard", version: 3,
  overallPassRuleJson: { type: "percent", value: 70 }, createdBy: "author1",
};

const TOPIC_QUESTIONS = [
  {
    id: "q1", topicId: "t1", type: "single", prompt: "Вопрос",
    dataJson: { options: ["A", "B", "C", "D"] }, correctJson: { correctIndex: 0 }, difficulty: 40,
  },
];

/** Две веб-попытки одного участника: первая верная, вторая нет. */
const ATTEMPTS = [
  {
    id: "a1", userId: "u1", testId: "test1", snapshotId: null,
    variantJson: { sections: [{ topicId: "t1", questionIds: ["q1"] }], psychoHashes: { q1: "hash-1" } },
    answersJson: { q1: 0 },
    resultJson: { overallPercent: 100, questionOutcomes: [{ questionId: "q1", result: "correct", earned: 1, possible: 1 }] },
    startedAt: new Date("2026-09-01T10:00:00Z"),
    finishedAt: new Date("2026-09-01T10:10:00Z"),
  },
  {
    id: "a2", userId: "u1", testId: "test1", snapshotId: null,
    variantJson: { sections: [{ topicId: "t1", questionIds: ["q1"] }], psychoHashes: { q1: "hash-1" } },
    answersJson: { q1: 1 },
    resultJson: { overallPercent: 0, questionOutcomes: [{ questionId: "q1", result: "incorrect", earned: 0, possible: 1 }] },
    startedAt: new Date("2026-09-05T10:00:00Z"),
    finishedAt: new Date("2026-09-05T10:10:00Z"),
  },
];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", psychometricsRouter);
  return app;
}

const ask = (query = "") =>
  request(makeApp()).get(`/api/analytics/psychometrics/test1${query}`).set("x-test-user", "a1");

beforeEach(() => {
  vi.clearAllMocks();
  // Кэш живёт в модуле и переживает отдельный тест — как и в бою между запросами.
  resetPsychometricsCache();
  storageMock.getUser.mockResolvedValue({ id: "a1", name: "Админ", email: "a@b.c" });
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTests.mockResolvedValue([TEST]);
  storageMock.getTestSections.mockResolvedValue([{ id: "s1", testId: "test1", topicId: "t1" }]);
  storageMock.getQuestionsByTopic.mockResolvedValue(TOPIC_QUESTIONS);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getLmsImportBatches.mockResolvedValue([]);
  storageMock.getSlices.mockResolvedValue([]);
  storageMock.getQuestionsByIds.mockResolvedValue(TOPIC_QUESTIONS);
  storageMock.getAttemptsByIds.mockResolvedValue(ATTEMPTS);
  storageMock.selectAnswersForAttempts.mockResolvedValue([]);
  storageMock.selectGroupsOfUsers.mockResolvedValue(new Map());
  storageMock.selectObservations.mockResolvedValue({
    web: ATTEMPTS,
    lms: [],
    order: ATTEMPTS.map(a => ({ id: a.id, source: "web" })),
    total: ATTEMPTS.length,
  });
});

describe("GET /analytics/psychometrics/:testId", () => {
  it("считает психометрику теста", async () => {
    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ questionId: "q1", declaredDifficulty: 40 });
  });

  it("по умолчанию берёт ТОЛЬКО первую попытку участника", async () => {
    // Повторная попытка не независима: человек помнит задания. Первая — верная, значит
    // трудность равна единице; учти ручка обе, вышло бы 0,5.
    const res = await ask();

    expect(res.body.firstAttemptOnly).toBe(true);
    expect(res.body.items[0].difficulty).toBe(1);
    expect(res.body.sample.responses).toBe(1);
  });

  it("режим со всеми попытками включается явно", async () => {
    const res = await ask("?firstAttemptOnly=false");

    expect(res.body.firstAttemptOnly).toBe(false);
    expect(res.body.items[0].difficulty).toBe(0.5);
    expect(res.body.sample.responses).toBe(2);
  });

  it("называет состав выборки по источникам", async () => {
    const res = await ask();
    expect(res.body.sample.bySource).toEqual({ web: 1 });
  });

  it("на пустой выборке отвечает пустотой, а не ошибкой", async () => {
    // Скудная выборка не повод ронять экран: метрика деградирует до «недостаточно данных».
    storageMock.selectObservations.mockResolvedValue({ web: [], lms: [], order: [], total: 0 });

    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.reliability).toBe("too-few-items");
  });

  it("неизвестный тест — 404", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    expect((await ask()).status).toBe(404);
  });

  it("чужой тест не отдаётся", async () => {
    // Право открывает действие, тест решает: область у психометрики ТА ЖЕ, что у аналитики.
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTests.mockResolvedValue([]);

    expect((await ask()).status).toBe(403);
  });

  it("повторный запрос с теми же условиями считается из кэша", async () => {
    await ask();
    const callsAfterFirst = storageMock.selectObservations.mock.calls.length;
    await ask();

    expect(storageMock.selectObservations.mock.calls.length).toBe(callsAfterFirst);
  });

  it("смена условий отбора кэш не переиспользует", async () => {
    await ask();
    const callsAfterFirst = storageMock.selectObservations.mock.calls.length;
    await ask("?source=web");

    expect(storageMock.selectObservations.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("отдаёт психометрический отчёт файлом", async () => {
    const res = await request(makeApp())
      .get("/api/analytics/psychometrics/test1/export")
      .set("x-test-user", "a1");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain("psychometrics");
  });

  it("отдаёт матрицу ответов файлом", async () => {
    const res = await request(makeApp())
      .get("/api/analytics/psychometrics/test1/matrix")
      .set("x-test-user", "a1");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("response_matrix");
  });

  it("выгрузка требует права на выгрузку, а не только на чтение", async () => {
    // Файл уносят из системы — это отдельное действие, и право у него своё.
    storageMock.getUserRoles.mockResolvedValue(["manager"]);

    const res = await request(makeApp())
      .get("/api/analytics/psychometrics/test1/export")
      .set("x-test-user", "a1");

    expect(res.status).toBe(403);
  });

  it("сравнение срезов считает психометрику по каждому срезу", async () => {
    // Свой механизм сравнения трек не заводит: срезы те же, что у раздела «Аналитика»,
    // меняется только содержимое таблиц (FR-04b, FR-04b1).
    storageMock.getSlices.mockResolvedValue([
      { id: "s1", name: "Розница", conditionsJson: { groupIds: ["g1"] } },
      { id: "s2", name: "Опт", conditionsJson: { groupIds: ["g2"] } },
    ]);

    const res = await request(makeApp())
      .get("/api/analytics/psychometrics/test1/slices?withWhole=1")
      .set("x-test-user", "a1");

    expect(res.status).toBe(200);
    expect(res.body.slices.map((s: { name: string }) => s.name))
      .toEqual(["Тест целиком", "Розница", "Опт"]);
    expect(res.body.slices[0]).toHaveProperty("alpha");
    expect(res.body.slices[0]).toHaveProperty("suspiciousCount");
  });

  it("срез отдаёт трудность ПО ЗАДАНИЯМ — иначе сравнивать нечего", async () => {
    storageMock.getSlices.mockResolvedValue([
      { id: "s1", name: "Розница", conditionsJson: { groupIds: ["g1"] } },
    ]);

    const res = await request(makeApp())
      .get("/api/analytics/psychometrics/test1/slices?sliceId=s1")
      .set("x-test-user", "a1");

    expect(res.body.slices).toHaveLength(1);
    expect(res.body.slices[0].items[0]).toMatchObject({ questionId: "q1" });
  });

  it("снятие партии с учёта пересчитывает, а не отдаёт прежние числа", async () => {
    // Партия в ключе кэша именно поэтому: она меняет выборку, не трогая ни теста, ни его
    // содержания, и без неё экран после переключения выглядел бы сломанным.
    storageMock.getLmsImportBatches.mockResolvedValue([{ id: "b1", counted: true }]);
    await ask();
    const callsAfterFirst = storageMock.selectObservations.mock.calls.length;

    storageMock.getLmsImportBatches.mockResolvedValue([{ id: "b1", counted: false }]);
    await ask();

    expect(storageMock.selectObservations.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
