/**
 * @module client/features/analytics/__tests__/question-metrics
 * @description PRD-55 (FR-31, FR-31a, FR-32): что карточка задания говорит о выдаче и времени.
 *
 * Проверяется в первую очередь поведение ПУСТЫХ значений. Счётчик может быть пуст (данных ещё
 * нет), время может не измеряться вовсе (веб-прохождения и пакеты старше 2026-09-12), и в обоих
 * случаях ноль на экране был бы ложью: «не выдавалось ни разу» и «не учитывали» — разные вещи.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuestionMetrics, formatDuration } from "../question-metrics";

const base = {
  correctPercent: 74,
  correctTone: "success" as const,
  correctAnswers: 42,
  totalAnswers: 57,
  exposurePercent: 81,
  exposureCount: 46,
  globalExposureCount: 46,
  otherTestsCount: 0,
  latencyMedianMs: 84000,
  latencySampleSize: 31,
  attemptsInWindow: 57,
};

describe("QuestionMetrics", () => {
  it("показывает три величины разом", () => {
    render(<QuestionMetrics {...base} />);
    expect(screen.getByText("74%")).toBeInTheDocument();
    expect(screen.getByText("81%")).toBeInTheDocument();
    expect(screen.getByText("1:24")).toBeInTheDocument();
  });

  it("подписывает объём выборки времени отдельно от числа ответов", () => {
    render(<QuestionMetrics {...base} />);
    // 57 ответов, но измерений всего 31 — веб времени не даёт, и это должно быть видно.
    expect(screen.getByText("42/57 верно")).toBeInTheDocument();
    expect(screen.getByText("по 31 ответам")).toBeInTheDocument();
  });

  it("пустой счётчик даёт прочерк, а не ноль процентов", () => {
    render(<QuestionMetrics {...base} exposurePercent={null} exposureCount={0} />);
    expect(screen.getByText("показы не учтены")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("отсутствие измерений времени даёт прочерк, а не ноль секунд", () => {
    render(<QuestionMetrics {...base} latencyMedianMs={null} latencySampleSize={0} />);
    expect(screen.getByText("время не измерялось")).toBeInTheDocument();
    expect(screen.queryByText("0:00")).not.toBeInTheDocument();
  });

  it("показы по всем тестам появляются только у задания из нескольких тестов", () => {
    const { rerender } = render(<QuestionMetrics {...base} />);
    expect(screen.queryByText(/всего .* показов/)).not.toBeInTheDocument();

    rerender(<QuestionMetrics {...base} otherTestsCount={2} globalExposureCount={318} />);
    expect(screen.getByText("всего 318 показов")).toBeInTheDocument();
  });

  it("выдача ниже порога выработки банка не тревожит", () => {
    render(<QuestionMetrics {...base} exposurePercent={19} exposureCount={11} />);
    expect(screen.getByText("19%")).toBeInTheDocument();
    expect(screen.getByText("выдано 11 из 57")).toBeInTheDocument();
  });
});

describe("formatDuration", () => {
  it("секунды всегда двузначные — иначе колонка прыгает", () => {
    expect(formatDuration(62000)).toBe("1:02");
  });

  it("округляет до секунды", () => {
    expect(formatDuration(22400)).toBe("0:22");
  });

  it("минуты не переводятся в часы: задание дольше часа — это уже не время на ответ", () => {
    expect(formatDuration(3_660_000)).toBe("61:00");
  });
});
