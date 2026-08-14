/**
 * @module tests/breakdown-persistence
 * @description PRD-50 FR-39: записи разреза области ТЕСТА сохраняются вместе с попыткой.
 * До этой работы они собирались только ради контекста формул и пропадали, поэтому блок
 * области теста (Э4) и аналитика без пересчёта были невозможны.
 */
import { describe, it, expect } from "vitest";
import { attemptResultSchema, breakdownEntrySchema } from "../shared/schema";

const entry = {
  scope: "test", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1, possible: 2,
  unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 50,
};

const base = {
  totalCorrect: 1, totalQuestions: 2, overallPercent: 50,
  totalEarnedPoints: 1, totalPossiblePoints: 2, overallPassed: false,
  topicResults: [],
};

describe("attemptResultSchema.breakdowns", () => {
  it("принимает записи области теста", () => {
    const parsed = attemptResultSchema.parse({ ...base, breakdowns: [entry] });
    expect(parsed.breakdowns).toEqual([entry]);
  });

  it("результат, сохранённый до этой работы, остаётся валидным", () => {
    expect(attemptResultSchema.parse(base).breakdowns).toBeUndefined();
  });

  it("схема записи одна на все места хранения", () => {
    // Страж от второй копии: три места (тема, тест, адаптивная тема) обязаны разбирать
    // запись ОДНОЙ схемой, иначе поле, добавленное в одном, молча потеряется в двух других.
    expect(breakdownEntrySchema.parse(entry)).toEqual(entry);
  });
});
