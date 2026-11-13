/**
 * @module server/services/analytics/__tests__/attempt-topics
 * @description Итог одного прохождения по темам — веб из сохранённого результата, LMS из ответов.
 */
import { describe, expect, it } from "vitest";

import type { AnswerFact } from "../answers";
import { lmsAttemptTopics, webAttemptTopics, type LmsTopicInput } from "../attempt-topics";

/** Ответ LMS с исходом и, при необходимости, баллами пакета. */
function fact(questionId: string, result: AnswerFact["result"], points?: [number, number]): AnswerFact {
  return {
    questionId,
    attemptId: "a1",
    result,
    source: "import",
    latencyMs: null,
    earnedPoints: points ? points[0] : null,
    possiblePoints: points ? points[1] : null,
    answer: null,
  };
}

/** Тест из двух тем: q1, q2 — тема A, q3 — тема B, m1 — измерительное задание темы B. */
function input(overrides: Partial<LmsTopicInput>): LmsTopicInput {
  const topic: Record<string, string> = { q1: "A", q2: "A", q3: "B", m1: "B", q4: "A" };
  const price: Record<string, number | null> = { q1: 2, q2: 3, q3: 5, m1: null, q4: 5 };
  return {
    facts: [],
    delivered: null,
    topicOf: id => topic[id] ?? null,
    priceOf: id => (id in price ? price[id] : null),
    ruleOf: () => ({ type: "percent", value: 60 }),
    ...overrides,
  };
}

describe("webAttemptTopics", () => {
  it("берёт баллы и итог темы из сохранённого результата", () => {
    const out = webAttemptTopics({
      topicResults: [
        { topicId: "A", earnedPoints: 7, possiblePoints: 10, passed: true },
        { topicId: "B", earnedPoints: 1, possiblePoints: 4, passed: false },
      ],
    });
    expect(out.get("A")).toEqual({ earned: 7, possible: 10, percent: 70, passed: true });
    expect(out.get("B")).toEqual({ earned: 1, possible: 4, percent: 25, passed: false });
  });

  it("тема без порога — итога нет, баллы есть", () => {
    const out = webAttemptTopics({ topicResults: [{ topicId: "A", earnedPoints: 2, possiblePoints: 4, passed: null }] });
    expect(out.get("A")).toEqual({ earned: 2, possible: 4, percent: 50, passed: null });
  });

  it("тема без оцениваемых заданий — ни процента, ни итога", () => {
    const out = webAttemptTopics({ topicResults: [{ topicId: "A", earnedPoints: 0, possiblePoints: 0, passed: true }] });
    expect(out.get("A")).toEqual({ earned: 0, possible: 0, percent: null, passed: null });
  });

  it("нет результата — нет тем", () => {
    expect(webAttemptTopics(null).size).toBe(0);
    expect(webAttemptTopics({}).size).toBe(0);
  });
});

describe("lmsAttemptTopics", () => {
  it("считает баллы темы по цене задания в тесте и судит по порогу темы", () => {
    const out = lmsAttemptTopics(input({
      facts: [fact("q1", "correct"), fact("q2", "incorrect"), fact("q3", "correct")],
    }));
    // A: 2 из 5 = 40 % < 60 %; B: 5 из 5.
    expect(out.get("A")).toEqual({ earned: 2, possible: 5, percent: 40, passed: false });
    expect(out.get("B")).toEqual({ earned: 5, possible: 5, percent: 100, passed: true });
  });

  it("частичный ответ приносит долю цены — по баллам пакета, а не по исходу", () => {
    const out = lmsAttemptTopics(input({ facts: [fact("q2", "incorrect", [0.5, 1])] }));
    expect(out.get("A")).toEqual({ earned: 1.5, possible: 3, percent: 50, passed: false });
  });

  it("измерительный ответ в баллы не идёт: тема без оцениваемых заданий без итога", () => {
    const out = lmsAttemptTopics(input({ facts: [fact("m1", "neutral")] }));
    expect(out.get("B")).toEqual({ earned: 0, possible: 0, percent: null, passed: null });
  });

  it("выданное, но не отвеченное задание добавляет достижимые баллы", () => {
    const out = lmsAttemptTopics(input({
      facts: [fact("q1", "correct"), fact("q2", "correct")],
      delivered: ["q1", "q2", "q4"],
    }));
    // A: 5 из 10.
    expect(out.get("A")).toEqual({ earned: 5, possible: 10, percent: 50, passed: false });
  });

  it("порог в баллах сравнивает набранные баллы, а порога нет — итога нет", () => {
    const counted = lmsAttemptTopics(input({
      facts: [fact("q1", "correct")],
      ruleOf: () => ({ type: "count", value: 2 }),
    }));
    expect(counted.get("A")?.passed).toBe(true);

    const ungated = lmsAttemptTopics(input({ facts: [fact("q1", "correct")], ruleOf: () => null }));
    expect(ungated.get("A")?.passed).toBeNull();
  });

  it("повторный ответ на задание заменяет прежний, а не удваивает цену", () => {
    const out = lmsAttemptTopics(input({ facts: [fact("q1", "incorrect"), fact("q1", "correct")] }));
    expect(out.get("A")).toEqual({ earned: 2, possible: 2, percent: 100, passed: true });
  });

  it("задание без темы пропускается", () => {
    const out = lmsAttemptTopics(input({ facts: [fact("zz", "correct")] }));
    expect(out.size).toBe(0);
  });
});
