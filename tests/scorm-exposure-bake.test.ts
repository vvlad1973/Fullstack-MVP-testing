/**
 * @module tests/scorm-exposure-bake
 * @description PRD-55 (FR-27, FR-29, FR-30): вес экспозиции уезжает в пакет ГОТОВЫМ числом,
 * нормированным в пределах раздела на момент сборки.
 *
 * Пакет автономен: счётчика по популяции у него нет и быть не может, поэтому считать вес в
 * рантайме нечем. Поле добавляется в TEST_DATA только когда вес отличается от единицы — то же
 * правило, что у `tags` и `orderIndex`: пакеты нетронутых тестов обязаны собираться
 * байт-в-байт как раньше.
 */
import { describe, it, expect } from "vitest";
import { buildTestJson } from "../server/scorm/builders/test-json";

const baseTest = {
  id: "test1", title: "Тест", mode: "standard", version: 1,
  overallPassRuleJson: { type: "percent", value: 70 },
  showDifficultyLevel: true,
};

function q(id: string) {
  return {
    id, type: "single", prompt: "?", dataJson: {}, correctJson: { correctIndex: 0 },
    points: 1, difficulty: 50, tags: [],
  };
}

function section(id: string, topicId: string, questions: ReturnType<typeof q>[]) {
  return {
    id, topicId, drawCount: 1, required: true, feedbackJson: null,
    topic: { id: topicId, name: "Тема", feedback: null, feedbackJson: null },
    questions,
    courses: [], events: [],
  };
}

function fixture(sections: ReturnType<typeof section>[], exposureCounts?: Map<string, number>) {
  return { test: baseTest, sections, ...(exposureCounts ? { exposureCounts } : {}) } as never;
}

const bake = (data: unknown): any => JSON.parse(buildTestJson(data as never));

/** Вопросы первого раздела запечённого TEST_DATA. */
const questionsOf = (baked: any, sectionIndex = 0) => baked.sections[sectionIndex].questions;

describe("вес экспозиции в TEST_DATA", () => {
  it("не появляется, когда счётчиков нет вовсе", () => {
    const baked = bake(fixture([section("s1", "t1", [q("a"), q("b")])]));
    for (const item of questionsOf(baked)) {
      expect(item).not.toHaveProperty("exposureWeight");
    }
  });

  it("не появляется, когда все счётчики равны", () => {
    const counts = new Map([["a", 7], ["b", 7]]);
    const baked = bake(fixture([section("s1", "t1", [q("a"), q("b")])], counts));
    for (const item of questionsOf(baked)) {
      expect(item).not.toHaveProperty("exposureWeight");
    }
  });

  it("появляется числом при неравных счётчиках", () => {
    const counts = new Map([["a", 10], ["b", 0]]);
    const baked = bake(fixture([section("s1", "t1", [q("a"), q("b")])], counts));
    const [a, b] = questionsOf(baked);
    // Горячее задание весит единицу — и поле у него не пишется, потому что единица и есть
    // умолчание рантайма.
    expect(a).not.toHaveProperty("exposureWeight");
    expect(b.exposureWeight).toBe(4);
  });

  it("нормируется в пределах РАЗДЕЛА, а не всего теста", () => {
    const counts = new Map([["a", 10], ["b", 0], ["c", 1000], ["d", 990]]);
    const baked = bake(fixture(
      [section("s1", "t1", [q("a"), q("b")]), section("s2", "t2", [q("c"), q("d")])],
      counts,
    ));
    // В каждом разделе свой минимум получает предельный вес, хотя абсолютные числа разные.
    expect(questionsOf(baked, 0)[1].exposureWeight).toBe(4);
    expect(questionsOf(baked, 1)[1].exposureWeight).toBe(4);
  });

  it("промежуточное задание получает дробный вес", () => {
    const counts = new Map([["a", 10], ["b", 5], ["c", 0]]);
    const baked = bake(fixture([section("s1", "t1", [q("a"), q("b"), q("c")])], counts));
    expect(questionsOf(baked)[1].exposureWeight).toBeCloseTo(2.5, 10);
  });
});
