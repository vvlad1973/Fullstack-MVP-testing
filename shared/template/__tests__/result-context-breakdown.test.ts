/**
 * @module shared/template/__tests__/result-context-breakdown
 * @description PRD-50 FR-31 - FR-33: breakdown rows inside the topic card, hidden unless
 * the author turned them on.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext } from "../result-context";

const topic = {
  topicName: "Право", correct: 1, total: 2, percent: 50, earnedPoints: 1, possiblePoints: 2,
  passed: false,
  breakdown: [
    { scope: "section:law", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1, possible: 2,
      unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 40 },
  ],
};
const result = { passed: false, percent: 50, totalQuestions: 2, correct: 1,
  earnedPoints: 1, possiblePoints: 2, topicResults: [topic] };

describe("разрез в карточке темы", () => {
  it("при hidden полос нет", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      breakdownDisplay: { visibility: "hidden", basis: "units" },
    } as never);
    expect((ctx.result.topicResults![0] as never as { breakdown?: unknown[] }).breakdown).toBeUndefined();
  });

  it("при bar печатает полосу по нормированной базе и без числа", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      breakdownDisplay: { visibility: "bar", basis: "units" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ key: "ПДн", barPercent: 40, showValue: false });
  });

  it("при bar_and_value и базе points печатает балльный процент", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      breakdownDisplay: { visibility: "bar_and_value", basis: "points" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ barPercent: 50, showValue: true, valueLabel: "50 %" });
  });
});

describe("полный состав строки (§8.1)", () => {
  it("строка несёт счётчики, баллы и обе базы, а не только полосу", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      breakdownDisplay: { visibility: "bar_and_value", basis: "units" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    // toEqual, а не toMatchObject: контракт строки — это её ПОЛНЫЙ состав. Лишнее поле
    // здесь так же значимо, как недостающее: сторонний шаблон реестра PRD-3 привязывается
    // к именам, и молча появившееся имя потом придётся возить по обоим хостам.
    expect(rows[0]).toEqual({
      key: "ПДн",
      items: 2,
      answered: 2,
      earned: 1,
      possible: 2,
      percent: 40,
      percentUnits: 40,
      percentPoints: 50,
      barPercent: 40,
      showValue: true,
      valueLabel: "40 %",
      // §8.1, с Э2: no threshold on this fixture's key → the row asserts nothing.
      passed: null,
      passClass: "",
      statusLabel: "",
    });
  });

  it("percent следует ВЫБРАННОЙ базе, а percentPoints остаётся валютой вердикта", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      breakdownDisplay: { visibility: "bar", basis: "points" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0].percent).toBe(50);
    expect(rows[0].percentUnits).toBe(40);
    expect(rows[0].percentPoints).toBe(50);
  });

  it("дробные значения приходят с одним знаком, а не сырым отношением", () => {
    const messy = {
      ...topic,
      breakdown: [
        { scope: "section:law", axis: "tag", key: "ПДн", items: 3, answered: 3,
          earned: 5 / 3, possible: 3, unitEarned: 5 / 9, unitPossible: 3,
          percentPoints: (5 / 9) * 100, percentUnits: (5 / 27) * 100 },
      ],
    };
    const ctx = buildResultContext({ ...result, topicResults: [messy] } as never, "Тест", {
      breakdownDisplay: { visibility: "bar_and_value", basis: "points" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0].earned).toBe(1.7);
    expect(rows[0].percentPoints).toBe(55.6);
    expect(rows[0].barPercent).toBe(56);
  });
});

describe("вердикт ключа в строке разреза (§8.1, с Э2)", () => {
  const withVerdict = (passed: boolean | null) => ({
    ...result,
    topicResults: [{ ...topic, breakdown: [{ ...topic.breakdown[0], passed }] }],
  });

  it("порог пройден — класс и подпись как у темы", () => {
    const ctx = buildResultContext(withVerdict(true) as never, "Тест", {
      breakdownDisplay: { visibility: "bar", basis: "units" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ passed: true, passClass: "is-pass", statusLabel: "Пройдено" });
  });

  it("порог не пройден", () => {
    const ctx = buildResultContext(withVerdict(false) as never, "Тест", {
      breakdownDisplay: { visibility: "bar", basis: "units" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ passed: false, passClass: "is-fail", statusLabel: "Не пройдено" });
  });

  it("порога нет — строка молчит о вердикте, а не утверждает «не пройдено»", () => {
    const ctx = buildResultContext(withVerdict(null) as never, "Тест", {
      breakdownDisplay: { visibility: "bar", basis: "units" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ passed: null, passClass: "", statusLabel: "" });
  });
});
