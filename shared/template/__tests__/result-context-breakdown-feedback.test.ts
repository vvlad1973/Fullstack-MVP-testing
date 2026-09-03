/**
 * @module shared/template/__tests__/result-context-breakdown-feedback.test
 * @description PRD-50 FR-50: текст подтемы доходит до блока «Рекомендации» по правилу
 * владельца — ниже общего порога теста, при ЛЮБОМ вердикте.
 *
 * Проверяется здесь, у общего построителя: он один на веб-хост и на рантайм пакета, и
 * если тексты собираются тут, то и экран, и пакет печатают одно и то же.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext } from "../result-context";

const entry = (key: string, percentPoints: number) => ({
  scope: "section:law",
  axis: "tag",
  key,
  items: 2,
  answered: 2,
  earned: 1,
  possible: 2,
  unitEarned: 1,
  unitPossible: 2,
  percentPoints,
  percentUnits: percentPoints,
});

const TEXTS = {
  pd: { text: "Повторите тему персональных данных" },
  kt: { text: "Освежите правила коммерческой тайны" },
};

function resultWith(passed: boolean, topicPassed: boolean | null) {
  return {
    passed,
    percent: 80,
    totalQuestions: 4,
    correct: 3,
    earnedPoints: 8,
    possiblePoints: 10,
    topicResults: [
      {
        topicId: "law",
        topicName: "Право",
        correct: 3,
        total: 4,
        percent: 80,
        earnedPoints: 8,
        possiblePoints: 10,
        passed: topicPassed,
        breakdown: [entry("pd", 45), entry("kt", 90)],
        breakdownFeedback: TEXTS,
      },
    ],
  };
}

const texts = (ctx: ReturnType<typeof buildResultContext>) =>
  ctx.result.recommendations?.texts ?? [];

describe("тексты подтем в блоке рекомендаций (FR-50)", () => {
  it("подтема ниже общего порога говорит, подтема выше молчит", () => {
    const ctx = buildResultContext(resultWith(true, true) as never, "Тест", {
      overallPassRule: { type: "percent", value: 70 },
    } as never);
    expect(texts(ctx)).toEqual([TEXTS.pd.text]);
  });

  it("сданный тест и пройденная тема текст НЕ гасят: правило про подтему", () => {
    // Обратную связь ТЕМЫ пройденная тема гасит — это соседнее правило и оно осталось.
    // Подтема не судится, и её текст обязан выйти именно в этом случае: человек сдал, но
    // в одном срезе провалился.
    const ctx = buildResultContext(resultWith(true, true) as never, "Тест", {
      hasPassThreshold: true,
      overallPassRule: { type: "percent", value: 70 },
    } as never);
    expect(texts(ctx)).toContain(TEXTS.pd.text);
  });

  it("порог в баллах переводится в долю от достижимого", () => {
    // 8 баллов из 10 достижимых => порог 80 %; подтема с 45 % ниже, с 90 % выше.
    const ctx = buildResultContext(resultWith(false, false) as never, "Тест", {
      overallPassRule: { type: "absolute", value: 8 },
    } as never);
    expect(texts(ctx)).toEqual([TEXTS.pd.text]);
  });

  it("без общего порога выдаётся всё написанное: сравнивать не с чем", () => {
    const ctx = buildResultContext(resultWith(false, null) as never, "Тест", {} as never);
    expect(texts(ctx)).toEqual([TEXTS.pd.text, TEXTS.kt.text]);
  });

  it("тест без текстов подтем оставляет блок прежним", () => {
    const bare = resultWith(false, false);
    delete (bare.topicResults[0] as { breakdownFeedback?: unknown }).breakdownFeedback;
    const ctx = buildResultContext(bare as never, "Тест", {
      overallPassRule: { type: "percent", value: 70 },
    } as never);
    expect(texts(ctx)).toEqual([]);
  });

  it("текст, повторяющий обратную связь теста, печатается один раз", () => {
    const ctx = buildResultContext(resultWith(false, false) as never, "Тест", {
      testFeedback: { text: TEXTS.pd.text },
      overallPassRule: { type: "percent", value: 70 },
    } as never);
    expect(texts(ctx)).toEqual([TEXTS.pd.text]);
  });
});
