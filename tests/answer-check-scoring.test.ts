import { describe, it, expect } from "vitest";
import { scoreAnswer, explainAnswer } from "../shared/scoring/engine";

const correct = {
  answerKind: "text",
  join: "any",
  rules: [{ kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" }],
} as const;

describe("scoreAnswer — короткий ответ", () => {
  it("зачитывает подходящий ответ", () => {
    const r = scoreAnswer({ type: "short", correct, answer: "Федеральная служба по атомному надзору" });
    expect(r.ratio).toBe(1);
  });

  it("не зачитывает неподходящий", () => {
    expect(scoreAnswer({ type: "short", correct, answer: "Минэнерго" }).ratio).toBe(0);
  });

  it("не зачитывает пустой и отсутствующий ответ", () => {
    expect(scoreAnswer({ type: "short", correct, answer: "" }).ratio).toBe(0);
    expect(scoreAnswer({ type: "short", correct, answer: null }).ratio).toBe(0);
  });

  it("считает счётчики один к одному", () => {
    const hit = explainAnswer({ type: "short", correct, answer: "федеральная служба по горному надзору" });
    expect({ c: hit.c, x: hit.x, total: hit.total }).toEqual({ c: 1, x: 0, total: 1 });
    const miss = explainAnswer({ type: "short", correct, answer: "нет" });
    expect({ c: miss.c, x: miss.x, total: miss.total }).toEqual({ c: 0, x: 1, total: 1 });
  });

  it("набор без правил не приносит балла", () => {
    const empty = { answerKind: "text", join: "any", rules: [] } as const;
    expect(scoreAnswer({ type: "short", correct: empty, answer: "что угодно" }).ratio).toBe(0);
  });
});
