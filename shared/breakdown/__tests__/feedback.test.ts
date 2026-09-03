/**
 * @module shared/breakdown/__tests__/feedback.test
 * @description PRD-50 FR-50: правило выдачи текстов подтем — «ниже общего порога теста,
 * при любом вердикте» (решение владельца 2026-09-03).
 *
 * Правило одно на оба хоста, поэтому проверяется здесь, у самого правила, а не дважды в
 * снимках контекста: разойтись экран и пакет могут только если разойдётся эта функция.
 */
import { describe, it, expect } from "vitest";
import { collectBreakdownFeedback, passThresholdPercent } from "../feedback";
import type { BreakdownEntry } from "../types";

function entry(key: string, percentPoints: number): BreakdownEntry {
  return {
    scope: "test",
    axis: "tag",
    key,
    items: 4,
    answered: 4,
    earned: percentPoints / 25,
    possible: 4,
    unitEarned: 2,
    unitPossible: 4,
    percentPoints,
    percentUnits: 50,
  };
}

const TEXTS = {
  pd: { text: "Повторите тему персональных данных" },
  kt: { text: "Освежите правила коммерческой тайны" },
};

describe("passThresholdPercent", () => {
  it("процентное правило берётся как есть", () => {
    expect(passThresholdPercent({ type: "percent", value: 70 }, 40)).toBe(70);
  });

  it("правило в баллах переводится в долю от достижимого", () => {
    expect(passThresholdPercent({ type: "absolute", value: 30 }, 40)).toBe(75);
  });

  it("без порога, без правила и с нулём баллов сравнивать не с чем", () => {
    expect(passThresholdPercent({ type: "none", value: 0 }, 40)).toBeNull();
    expect(passThresholdPercent(null, 40)).toBeNull();
    expect(passThresholdPercent({ type: "absolute", value: 30 }, 0)).toBeNull();
  });
});

describe("collectBreakdownFeedback", () => {
  const topics = [
    {
      breakdown: [entry("pd", 45), entry("kt", 80)],
      breakdownFeedback: TEXTS,
    },
  ];

  it("выдаёт текст подтемы ниже порога и молчит о той, что выше", () => {
    expect(collectBreakdownFeedback(topics, 60)).toEqual([TEXTS.pd]);
  });

  it("ровно на пороге текста нет: порог — это «не ниже»", () => {
    expect(collectBreakdownFeedback([{ breakdown: [entry("pd", 60)], breakdownFeedback: TEXTS }], 60)).toEqual(
      [],
    );
  });

  it("без порога выдаётся всё написанное: условия нет", () => {
    expect(collectBreakdownFeedback(topics, null)).toEqual([TEXTS.pd, TEXTS.kt]);
  });

  it("подтема без написанного текста ничего не даёт", () => {
    expect(
      collectBreakdownFeedback([{ breakdown: [entry("zz", 10)], breakdownFeedback: TEXTS }], 60),
    ).toEqual([]);
  });

  it("подтема, которой выдача не дала вопросов, в подытогах отсутствует и текста не даёт", () => {
    expect(collectBreakdownFeedback([{ breakdown: [], breakdownFeedback: TEXTS }], 60)).toEqual([]);
  });

  it("раздел без текстов подтем пропускается целиком", () => {
    expect(collectBreakdownFeedback([{ breakdown: [entry("pd", 10)] }], 60)).toEqual([]);
  });

  it("сравнивается доля БАЛЛОВ, а не доля вопросов", () => {
    // Доля вопросов у записи 50 % — выше порога; доля баллов 45 % — ниже. Судить обязана
    // вторая: порог теста задан в баллах.
    expect(collectBreakdownFeedback(topics, 48)).toEqual([TEXTS.pd]);
  });

  it("порядок — по разделам и записям внутри них", () => {
    const two = [
      { breakdown: [entry("kt", 10)], breakdownFeedback: TEXTS },
      { breakdown: [entry("pd", 10)], breakdownFeedback: TEXTS },
    ];
    expect(collectBreakdownFeedback(two, 60)).toEqual([TEXTS.kt, TEXTS.pd]);
  });
});
