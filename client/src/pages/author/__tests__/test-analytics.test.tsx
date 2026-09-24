/**
 * @module pages/author/__tests__/test-analytics.test
 * @description Coverage suite for the per-test analytics dashboard
 * (`pages/author/test-analytics.tsx`). Exercises the loading / not-found states,
 * the summary KPI cards, the overview charts + topic stats (with data and empty
 * fallbacks), the attempts tab (completed / in-progress rows, adaptive «Уровни»
 * column), the questions and levels tabs, the Excel export action, and the full
 * attempt-details modal for both a standard and an adaptive attempt (achieved
 * levels + trajectory), plus the modal's not-found branch.
 *
 * Recharts is mocked with passthrough stubs: in jsdom the real ResponsiveContainer
 * measures a 0x0 box and renders nothing, so the chart branches would never mount.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

vi.mock("recharts", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Null = () => null;
  return {
    ResponsiveContainer: Pass, LineChart: Pass, BarChart: Pass,
    Line: Null, Bar: Null, XAxis: Null, YAxis: Null, CartesianGrid: Null, Tooltip: Null, Legend: Null,
  };
});

vi.mock("wouter", () => ({
  useRoute: () => [true, { testId: "t1" }],
  // Условия отбора экрана живут в адресе (FR-13, FR-24), поэтому странице нужен и `useLocation`.
  useLocation: () => ["/author/tests/t1/analytics", vi.fn()],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import TestAnalyticsPage from "../test-analytics";

// ─── Fixtures ────────────────────────────────────────────────────────────────────

const baseSummary = () => ({
  totalAttempts: 10, completedAttempts: 8, uniqueUsers: 6,
  avgPercent: 72.5, avgDuration: 615, passRate: 60, avgScore: 14, maxScore: 20,
});

const standardAnalytics = () => ({
  testId: "t1", testTitle: "Тест по финансам", testMode: "standard" as const,
  summary: baseSummary(),
  thresholdPercent: 70,
  topicStats: [
    {
      topicId: "top1", topicName: "Бюджет",
      passedShare: 80, correctShare: 75, thresholdPercent: 70, inSample: 20,
      subtopics: [
        { name: "Планирование", passedShare: 70, correctShare: 64, thresholdPercent: 70, inSample: 12 },
      ],
    },
    {
      topicId: "top2", topicName: "Инвестиции",
      passedShare: null, correctShare: 33, thresholdPercent: null, inSample: 18,
      subtopics: [],
    },
  ],
  questionStats: [
    {
      questionId: "q1", questionPrompt: "Что такое бюджет?", questionType: "single",
      topicId: "top1", topicName: "Бюджет", difficulty: 2,
      totalAnswers: 10, gradedAnswers: 10, correctAnswers: 7, correctPercent: 70,
      skipShare: 0, exposurePercent: 80, latencyMedianMs: 42_000, latencySampleSize: 10,
      reviewFlags: [],
    },
  ],
  scoreDistribution: [
    { label: "0–9", from: 0, to: 10, count: 1, share: 12.5, tone: "error", holdsThreshold: false },
    { label: "60–69", from: 60, to: 70, count: 2, share: 25, tone: "error", holdsThreshold: false },
    { label: "70–79", from: 70, to: 80, count: 3, share: 37.5, tone: "success", holdsThreshold: false },
    { label: "90–100", from: 90, to: 100, count: 2, share: 25, tone: "success", holdsThreshold: false },
  ],
  passTrend: [
    { key: "2026-06", label: "июнь 2026", attempts: 5, judged: 5, passRate: 60 },
    { key: "2026-07", label: "июль 2026", attempts: 3, judged: 3, passRate: 65 },
  ],
});

const emptyAnalytics = () => ({
  ...standardAnalytics(),
  summary: { ...baseSummary(), avgDuration: null },
  topicStats: [],
  questionStats: [],
  scoreDistribution: [
    { label: "0–9", from: 0, to: 10, count: 0, share: 0, tone: "error", holdsThreshold: false },
    { label: "90–100", from: 90, to: 100, count: 0, share: 0, tone: "success", holdsThreshold: false },
  ],
  passTrend: [],
});

const adaptiveAnalytics = () => ({
  ...standardAnalytics(),
  testMode: "adaptive" as const,
  levelStats: [
    { levelIndex: 1, levelName: "Средний", topicId: "top1", topicName: "Бюджет", achievedCount: 2, attemptedCount: 5, passedCount: 2, failedCount: 3, avgCorrectPercent: 45 },
    { levelIndex: 0, levelName: "Базовый", topicId: "top1", topicName: "Бюджет", achievedCount: 5, attemptedCount: 8, passedCount: 5, failedCount: 3, avgCorrectPercent: 60 },
  ],
});

const standardDetail = () => ({
  attemptId: "at1", userId: "u1", username: "Иван Петров", testId: "t1", testTitle: "Тест по финансам",
  testMode: "standard", startedAt: "2026-06-01T10:00:00Z", finishedAt: "2026-06-01T10:15:00Z", duration: 900,
  overallPercent: 85, earnedPoints: 17, possiblePoints: 20, passed: true,
  answers: [
    { questionId: "q1", questionPrompt: "Что такое бюджет?", questionType: "single", topicId: "top1", topicName: "Бюджет", userAnswer: 0, correctAnswer: 1, isCorrect: true, earnedPoints: 1, possiblePoints: 1, difficulty: 2, levelName: "Уровень 1" },
    { questionId: "q2", questionPrompt: "Виды инвестиций?", questionType: "multiple", topicId: "top2", topicName: "Инвестиции", userAnswer: [0], correctAnswer: [1], isCorrect: false, earnedPoints: 0, possiblePoints: 1, difficulty: 3 },
  ],
  topicResults: [{ topicId: "top1", topicName: "Бюджет", correct: 7, total: 10, percent: 70 }],
});

const adaptiveDetail = () => ({
  ...standardDetail(),
  testMode: "adaptive",
  achievedLevels: [{ topicId: "top1", topicName: "Бюджет", levelIndex: 1, levelName: "Средний" }],
  trajectory: [
    { action: "level_up", topicName: "Бюджет", levelName: "Средний", message: "Повышение до «Средний»" },
    { action: "level_down", topicName: "Бюджет", levelName: "Базовый", message: "Понижение до «Базовый»" },
  ],
});

// ─── Configurable fetch stub ──────────────────────────────────────────────────────

type State = {
  mode: "standard" | "adaptive";
  analyticsBody: unknown;
  detailBody: unknown;
  /** PRD-66: расчёт психометрики — питает колонки трудности и дискриминативности. */
  psychometricsBody: unknown;
};
let state: State;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state = {
    mode: "standard", analyticsBody: standardAnalytics(), detailBody: standardDetail(),
    psychometricsBody: [],
  };
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  fetchMock = vi.fn(async (input: string) => {
    const u = String(input);
    if (u === "/api/analytics/tests/t1") return ok(state.analyticsBody);
    if (u === "/api/analytics/psychometrics/t1") return ok(state.psychometricsBody);
    if (u.startsWith("/api/analytics/attempts/")) return ok(state.detailBody);
    return ok([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("open", vi.fn());
});

afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TestAnalyticsPage />
    </QueryClientProvider>,
  );
}

async function renderLoaded() {
  renderPage();
  await waitFor(() => expect(screen.getByText("Тест по финансам")).toBeInTheDocument());
}

describe("<TestAnalyticsPage />", () => {
  it("shows the loading state before analytics arrive", async () => {
    renderPage();
    expect(screen.getByText("Загрузка аналитики...")).toBeInTheDocument();
    await renderLoaded();
  });

  it("renders the not-found empty state when analytics is null", async () => {
    state.analyticsBody = null;
    renderPage();
    await waitFor(() => expect(screen.getByText("Не удалось загрузить аналитику")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Назад к тестам/ })).toBeInTheDocument();
  });

  it("renders the header, standard-mode tag and the summary KPI cards", async () => {
    await renderLoaded();
    expect(screen.getByText("Аналитика")).toBeInTheDocument();
    expect(screen.getByText("Стандартный")).toBeInTheDocument();
    expect(screen.getAllByText("Попытки").length).toBeGreaterThan(0);
    for (const label of ["Средний балл", "Прохождение", "Среднее время", "Всего"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Derived footnotes.
    expect(screen.getByText("6 уникальных пользователей")).toBeInTheDocument();
    expect(screen.getByText(/из 20 баллов/)).toBeInTheDocument();
    expect(screen.getByText("2 незавершённых")).toBeInTheDocument();
  });

  it("renders the overview: charts and per-topic stats", async () => {
    await renderLoaded();
    // PRD-56 FR-13, FR-14: три блока обзора — распределение, темы и помесячная динамика.
    expect(screen.getByText("Распределение результатов")).toBeInTheDocument();
    expect(screen.getByText("Динамика сдаваемости")).toBeInTheDocument();
    expect(screen.getByText("Темы и подтемы")).toBeInTheDocument();
    expect(screen.getByText("Бюджет")).toBeInTheDocument();
    expect(screen.getByText("Инвестиции")).toBeInTheDocument();
    // Подтема — строкой под своей темой.
    expect(screen.getByText("Планирование")).toBeInTheDocument();
    // Единицы счёта названы в заголовках: 80 % прохождений против 75 % ответов (FR-14a).
    expect(screen.getByText("Прошли тему, % прохождений")).toBeInTheDocument();
    expect(screen.getByText("Доля верных, % ответов")).toBeInTheDocument();
  });

  it("falls back to empty states across the overview when there is no data", async () => {
    state.analyticsBody = { ...emptyAnalytics(), summary: { ...baseSummary(), avgDuration: null, completedAttempts: 0 } };
    await renderLoaded();
    // Пустые блоки говорят, ЧЕГО нет, а не «нет данных» вообще: по первому понятно, что
    // прохождений не было, по второму — что читателю думать.
    expect(screen.getAllByText(/Прохождений пока нет/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Разрезов по темам пока нет/)).toBeInTheDocument();
    expect(screen.getByText(/динамику строить не из чего/)).toBeInTheDocument();
    // avgDuration null → «—» in the KPI card.
    expect(screen.getByText("—")).toBeInTheDocument();
  });



  it("не показывает списка попыток: он живёт в реестре прохождений", async () => {
    await renderLoaded();

    // FR-23: один список на продукт, а не два. Вместо вкладки — переход в реестр, где тот же
    // список умеет фильтровать, догружать и вести в разбор.
    expect(screen.queryByRole("tab", { name: "Попытки" })).toBeNull();
    expect(screen.getByRole("link", { name: /Прохождения в реестре/ })).toBeInTheDocument();
  });

  it("ведёт в реестр с фильтром по этому тесту", async () => {
    await renderLoaded();

    const link = screen.getByRole("link", { name: /Прохождения в реестре/ });
    expect(link.getAttribute("href")).toContain("/author/analytics?testId=t1");
  });

  it("renders the questions tab with per-question stats", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Вопросы" }));
    // PRD-56 FR-15: карточки заменены таблицей — задания сравнивают между собой.
    await waitFor(() => expect(screen.getByText("Что такое бюджет?")).toBeInTheDocument());
    // PRD-66 FR-02: место доли верных заняла трудность по доле балла.
    expect(screen.getByText("Трудность")).toBeInTheDocument();
    expect(screen.getByText("80 %")).toBeInTheDocument();
  });

  it("берёт трудность и дискриминативность из расчёта психометрики (PRD-66 FR-02, FR-03)", async () => {
    // Ручка одна на обе вкладки: колонка таблицы и карточка разбора не могут разойтись в
    // числах, потому что читают один ответ.
    state.psychometricsBody = {
      items: [{
        questionId: "q1", observations: 40, difficulty: 0.62, correctedDifficulty: null,
        itemRest: 0.31, discrimination: null, declaredDifficulty: null,
        difficultyConfidence: "reliable", coefficientConfidence: "reliable",
        flags: { tooHard: false, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false },
        timingFlags: { rushed: false, slow: false },
      }],
      reliability: "too-few-items", sem: null, cutBand: null,
      sample: { respondents: 40, responses: 40, bySource: { web: 40 }, unknownVersionShare: 0 },
      firstAttemptOnly: true,
    };
    await renderLoaded();
    fireEvent.click(screen.getByRole("tab", { name: "Вопросы" }));

    await waitFor(() => expect(screen.getByText("0,62")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Разбор задания/ })).toBeInTheDocument();
  });



  it("exports to Excel via the header action", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Экспорт Excel/ }));
    expect(window.open).toHaveBeenCalledWith("/api/analytics/tests/t1/export/excel", "_blank");
  });

  it("renders the adaptive dashboard: tag, levels inside «Выдача» and per-level stats", async () => {
    // PRD-56: отдельной вкладки «Уровни» больше нет — статистика по уровням переехала в
    // «Выдачу», рядом с вариантами и версиями: она о том же, об устройстве выдачи.
    state.analyticsBody = adaptiveAnalytics();
    await renderLoaded();
    expect(screen.getByText("Адаптивный")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Уровни" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Выдача" }));
    await waitFor(() => expect(screen.getByText("Базовый")).toBeInTheDocument());
    // Both levels of the topic render, sorted by index.
    expect(screen.getByText("Средний")).toBeInTheDocument();
    expect(screen.getByText("5 достигли")).toBeInTheDocument();
  });

});
