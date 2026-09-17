/**
 * @module server/services/analytics/__tests__/answer-spread
 * @description PRD-56 FR-22: разброс ответов измерительного задания.
 */
import { describe, expect, it } from "vitest";

import { answerSpread } from "../answer-spread";

const GRADES = ["Никогда", "Иногда", "Часто", "Всегда"];
const STATEMENTS = ["Командный", "Вдохновляющий", "Целеустремлённый", "Процессный"];

describe("answerSpread — шкала", () => {
  it("считает долю ВЫБРАВШИХ каждую градацию", () => {
    const spread = answerSpread({
      type: "scale",
      options: GRADES,
      answers: [2, 2, 2, 1],
    });

    expect(spread?.answered).toBe(4);
    expect(spread?.options.map(o => Math.round(o.share))).toEqual([0, 25, 75, 0]);
  });

  it("читает индекс и строкой — выгрузка LMS присылает его так", () => {
    const spread = answerSpread({ type: "scale", options: GRADES, answers: ["1", 1] });

    expect(spread?.options[1].share).toBe(100);
  });

  it("не считает ответ, указывающий на несуществующую градацию", () => {
    // Вопрос мог потерять вариант после прохождения: ответ на него не должен ни падать,
    // ни смещать доли остальных.
    const spread = answerSpread({ type: "scale", options: GRADES, answers: [0, 9] });

    expect(spread?.answered).toBe(1);
    expect(spread?.options[0].share).toBe(100);
  });
});

describe("answerSpread — распределение баллов", () => {
  it("считает долю ОТДАННЫХ баллов, а не долю людей", () => {
    // Человек делит бюджет между несколькими утверждениями сразу, поэтому доли считаются от
    // розданных баллов: «доля выбравших» дала бы в сумме больше ста процентов.
    const spread = answerSpread({
      type: "allocation",
      options: STATEMENTS,
      answers: [
        { "0": 4, "1": 2, "2": 1 },
        { "0": 3, "3": 4 },
      ],
    });

    expect(spread?.answered).toBe(2);
    // Всего роздано 14: 7 первому, 2 второму, 1 третьему, 4 четвёртому.
    expect(spread?.options.map(o => Math.round(o.share))).toEqual([50, 14, 7, 29]);
  });

  it("не берёт в знаменатель ответ, где не роздано ничего", () => {
    const spread = answerSpread({
      type: "allocation",
      options: STATEMENTS,
      answers: [{ "0": 5 }, {}, { "1": 5 }],
    });

    expect(spread?.answered).toBe(2);
  });
});

describe("answerSpread — когда считать не из чего", () => {
  it("молчит без ответов", () => {
    expect(answerSpread({ type: "scale", options: GRADES, answers: [] })).toBeNull();
  });

  it("молчит без вариантов", () => {
    expect(answerSpread({ type: "scale", options: [], answers: [1] })).toBeNull();
  });

  it("молчит, когда ни один ответ не пригоден", () => {
    expect(answerSpread({ type: "allocation", options: STATEMENTS, answers: [null, 7] })).toBeNull();
  });
});
