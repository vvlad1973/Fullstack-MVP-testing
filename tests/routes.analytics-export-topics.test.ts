/**
 * @module tests/routes.analytics-export-topics
 * @description Итог прохождения по темам в книге выгрузки аналитики.
 *
 * Книга ОДНОГО теста получает на листе «Прохождения» три колонки на тему — баллы, процент и итог
 * «Пройдена / Не пройдена». Веб-попытка берёт их из сохранённого результата, прохождение LMS —
 * восстанавливает из ответов по цене задания и порогу темы. Книга по нескольким тестам кладёт те
 * же величины на длинный лист «Темы». У адаптивного теста исход темы — уровень, колонок тем нет.
 */
import ExcelJS from "exceljs";
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { observationsDouble } from "./helpers/observations-double";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTest: vi.fn(), getTests: vi.fn(), getTopics: vi.fn(),
    getAllAttempts: vi.fn(), async getAttemptsByTests(ids: string[]) { return ((await this.getAllAttempts()) ?? []).filter((a: { testId: string }) => ids.includes(a.testId)); }, getAllScormAttempts: vi.fn(), getScormPackages: vi.fn(),
    getQuestionsByIds: vi.fn(), getTopicCourses: vi.fn(),
    getTestSections: vi.fn(), getTestQuestionScoring: vi.fn(),
    getScales: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    selectObservations: vi.fn(),
    getScormAttemptMeasures: vi.fn().mockResolvedValue([]),
    getScormAttemptOutcomes: vi.fn().mockResolvedValue([]),
    selectAnswersForTest: vi.fn(),
    selectDeliveredQuestionIds: vi.fn(),
    selectOrgSpellings: vi.fn().mockResolvedValue({ organization: [], unit: [], position: [] }),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import exportRouter from "../server/routes/analytics/export";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 }, createdAt: new Date(),
};
const OTHER = { ...TEST, id: "test2", title: "Повторная сертификация" };

/** Тема 1 — порог 50 %; Тема 2 — «Не проверять отдельно». */
const SECTIONS = [
  { id: "s1", testId: "test1", topicId: "tA", sortOrder: 0, topicPassRuleJson: { source: "custom", type: "percent", value: 50 } },
  { id: "s2", testId: "test1", topicId: "tB", sortOrder: 1, topicPassRuleJson: { source: "none" } },
];

const question = (id: string, topicId: string) => ({
  id, topicId, type: "single", prompt: `Вопрос ${id}`,
  dataJson: { options: ["да", "нет"] }, correctJson: { correctIndex: 0 },
});
const QUESTIONS = [question("q1", "tA"), question("q2", "tA"), question("q3", "tB"), question("q4", "tB")];

const WEB = {
  id: "web-1", testId: "test1", userId: "u1",
  startedAt: new Date("2026-11-10T09:00:00Z"), finishedAt: new Date("2026-11-10T09:20:00Z"),
  variantJson: { sections: [] }, answersJson: {},
  resultJson: {
    overallPercent: 67, overallPassed: false, totalPossiblePoints: 3, totalEarnedPoints: 2,
    topicResults: [
      { topicId: "tA", topicName: "Тема 1", earnedPoints: 2, possiblePoints: 2, passed: true },
      { topicId: "tB", topicName: "Тема 2", earnedPoints: 0, possiblePoints: 1, passed: null },
    ],
  },
};

const IMPORTED = {
  id: "imp-1", testId: "test1", packageId: null, origin: "import",
  userId: null, participantKey: "p-1", groupId: null, lmsUserName: "Иванов Пётр",
  startedAt: new Date("2026-11-09T09:00:00Z"), finishedAt: new Date("2026-11-09T09:30:00Z"),
  resultPercent: 67, resultPassed: false, maxPoints: 100, totalPoints: 67,
};

/** Ответы импорта: Тема 1 — 1 из 2, Тема 2 — q3 верно, q4 выдан, но без ответа. */
const IMPORTED_ANSWERS = [
  { questionId: "q1", attemptId: "imp-1", result: "correct", latencyMs: null, points: null, maxPoints: null, userAnswer: 0, origin: "import" },
  { questionId: "q2", attemptId: "imp-1", result: "incorrect", latencyMs: null, points: null, maxPoints: null, userAnswer: 1, origin: "import" },
  { questionId: "q3", attemptId: "imp-1", result: "correct", latencyMs: null, points: null, maxPoints: null, userAnswer: 0, origin: "import" },
];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api", exportRouter);
  return app;
}

/** Выгрузить книгу и вернуть строки листа; `null` — листа нет. */
async function exportSheet(body: Record<string, unknown>, sheetName: string): Promise<unknown[][] | null> {
  const res = await request(makeApp())
    .post("/api/export/excel")
    .set("x-test-user", "author1")
    .send(body)
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => callback(null, Buffer.concat(chunks)));
    });
  expect(res.status).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(res.body as never);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return null;
  const rows: unknown[][] = [];
  sheet.eachRow(row => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

/** Строка листа по идентификатору прохождения, разложенная по заголовкам. */
function rowById(rows: unknown[][], id: string): Record<string, unknown> {
  const head = rows[0] as string[];
  const row = rows.find(r => r[1] === id);
  if (!row) throw new Error(`row ${id} not found`);
  return Object.fromEntries(head.map((h, i) => [h, row[i]]));
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "u1", name: "Морозова Анна", email: "a@b.c" });
  storageMock.getTest.mockImplementation(async (id: string) => (id === "test2" ? OTHER : TEST));
  storageMock.getTests.mockResolvedValue([TEST]);
  storageMock.getTopics.mockResolvedValue([{ id: "tA", name: "Тема 1" }, { id: "tB", name: "Тема 2" }]);
  storageMock.getQuestionsByIds.mockImplementation(async (ids: string[]) => QUESTIONS.filter(q => ids.includes(q.id)));
  storageMock.getTopicCourses.mockResolvedValue([]);
  storageMock.getTestSections.mockImplementation(async (testId: string) =>
    SECTIONS.map(s => ({ ...s, testId, id: `${testId}-${s.id}` })));
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.getAllAttempts.mockResolvedValue([WEB]);
  storageMock.getAllScormAttempts.mockResolvedValue([IMPORTED]);
  storageMock.selectAnswersForTest.mockImplementation(async (testId: string) =>
    (testId === "test1" ? IMPORTED_ANSWERS : []));
  storageMock.selectDeliveredQuestionIds.mockResolvedValue(new Map([["imp-1", ["q1", "q2", "q3", "q4"]]]));
});

describe("POST /api/export/excel — итог по темам", () => {
  it("книга одного теста: три колонки на тему в порядке разделов", async () => {
    const rows = (await exportSheet({ testIds: ["test1"] }, "Прохождения"))!;
    const head = rows[0] as string[];
    expect(head.slice(-6)).toEqual([
      "Тема 1: баллы", "Тема 1: %", "Тема 1: итог",
      "Тема 2: баллы", "Тема 2: %", "Тема 2: итог",
    ]);
  });

  it("веб-попытка берёт итог тем из сохранённого результата", async () => {
    const row = rowById((await exportSheet({ testIds: ["test1"] }, "Прохождения"))!, "web-1");
    expect(row["Тема 1: баллы"]).toBe(2);
    expect(row["Тема 1: %"]).toBe(100);
    expect(row["Тема 1: итог"]).toBe("Пройдена");
    // Порога у темы нет — баллы и процент есть, итога нет.
    expect(row["Тема 2: баллы"]).toBe(0);
    expect(row["Тема 2: %"]).toBe(0);
    expect(row["Тема 2: итог"]).toBe("—");
  });

  it("импорт восстанавливает итог тем из ответов, выданное без ответа входит в максимум", async () => {
    const row = rowById((await exportSheet({ testIds: ["test1"] }, "Прохождения"))!, "imp-1");
    // Тема 1: 1 из 2 = 50 % — порог 50 % взят.
    expect(row["Тема 1: баллы"]).toBe(1);
    expect(row["Тема 1: %"]).toBe(50);
    expect(row["Тема 1: итог"]).toBe("Пройдена");
    // Тема 2: q3 верно, q4 выдан и не отвечен — 1 из 2.
    expect(row["Тема 2: баллы"]).toBe(1);
    expect(row["Тема 2: %"]).toBe(50);
    expect(row["Тема 2: итог"]).toBe("—");
  });

  it("незавершённое прохождение — прочерки во всех колонках тем", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{ ...WEB, finishedAt: null, resultJson: null }]);
    const row = rowById((await exportSheet({ testIds: ["test1"] }, "Прохождения"))!, "web-1");
    expect([row["Тема 1: баллы"], row["Тема 1: %"], row["Тема 1: итог"]]).toEqual(["—", "—", "—"]);
  });

  it("адаптивный тест колонок тем не получает", async () => {
    const adaptive = { ...TEST, mode: "adaptive" };
    storageMock.getTests.mockResolvedValue([adaptive]);
    storageMock.getTest.mockResolvedValue(adaptive);
    const rows = (await exportSheet({ testIds: ["test1"] }, "Прохождения"))!;
    expect((rows[0] as string[]).some(h => h.endsWith(": итог"))).toBe(false);
  });

  it("книга по нескольким тестам: лист «Темы», строка на прохождение и тему", async () => {
    storageMock.getTests.mockResolvedValue([TEST, OTHER]);
    const passages = (await exportSheet({ testIds: ["test1", "test2"] }, "Прохождения"))!;
    expect((passages[0] as string[]).some(h => h.endsWith(": итог"))).toBe(false);

    const topics = (await exportSheet({ testIds: ["test1", "test2"] }, "Темы"))!;
    expect(topics[0]).toEqual(["Тест", "ID прохождения", "Участник", "Тема", "Баллы", "Макс. баллы", "%", "Итог"]);
    expect(topics.slice(1).filter(r => r[1] === "imp-1")).toEqual([
      ["Сертификация", "imp-1", "Иванов Пётр", "Тема 1", 1, 2, 50, "Пройдена"],
      ["Сертификация", "imp-1", "Иванов Пётр", "Тема 2", 1, 2, 50, "—"],
    ]);
    expect(topics.slice(1).filter(r => r[1] === "web-1").map(r => [r[3], r[7]])).toEqual([
      ["Тема 1", "Пройдена"],
      ["Тема 2", "—"],
    ]);
  });
});
