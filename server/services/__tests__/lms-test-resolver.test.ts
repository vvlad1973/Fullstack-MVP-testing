/**
 * @module server/services/__tests__/lms-test-resolver
 * @description PRD-54 раздел 6.2: определение теста по вопросам из шапки выгрузки.
 */
import { describe, it, expect } from "vitest";
import { resolveTestByQuestionIds } from "../lms-test-resolver";

/** Хранилище-заглушка: один тест «test-a» на теме «t1» с двумя вопросами. */
const store = {
  getQuestionsByIds: async (ids: string[]) =>
    [{ id: "q1", topicId: "t1" }, { id: "q2", topicId: "t1" }].filter((q) => ids.includes(q.id)),
  getTestSectionsByTopicIds: async () => [{ testId: "test-a", topicId: "t1" }],
};

describe("resolveTestByQuestionIds", () => {
  it("однозначный тест находится", async () => {
    expect(await resolveTestByQuestionIds(["q1", "q2"], store as never)).toEqual({
      testId: "test-a",
      foreign: [],
    });
  });

  it("чужие вопросы возвращаются списком, а не роняют разбор", async () => {
    expect(await resolveTestByQuestionIds(["q1", "zzz"], store as never)).toEqual({
      testId: "test-a",
      foreign: ["zzz"],
    });
  });

  it("ни одного совпадения — теста нет", async () => {
    expect(await resolveTestByQuestionIds(["zzz"], store as never)).toEqual({
      testId: null,
      foreign: ["zzz"],
    });
  });

  it("пустой список вопросов — теста нет", async () => {
    expect(await resolveTestByQuestionIds([], store as never)).toEqual({ testId: null, foreign: [] });
  });

  it("вопросы из двух тестов — теста нет", async () => {
    const two = {
      getQuestionsByIds: async () => [{ id: "q1", topicId: "t1" }, { id: "q3", topicId: "t2" }],
      getTestSectionsByTopicIds: async () => [
        { testId: "test-a", topicId: "t1" },
        { testId: "test-b", topicId: "t2" },
      ],
    };
    expect((await resolveTestByQuestionIds(["q1", "q3"], two as never)).testId).toBeNull();
  });

  it("две темы ОДНОГО теста — тест находится", async () => {
    // Выгрузка теста из двух разделов даёт вопросы двух тем; это норма, а не двусмысленность.
    const twoTopics = {
      getQuestionsByIds: async () => [{ id: "q1", topicId: "t1" }, { id: "q3", topicId: "t2" }],
      getTestSectionsByTopicIds: async () => [
        { testId: "test-a", topicId: "t1" },
        { testId: "test-a", topicId: "t2" },
      ],
    };
    expect((await resolveTestByQuestionIds(["q1", "q3"], twoTopics as never)).testId).toBe("test-a");
  });
});
