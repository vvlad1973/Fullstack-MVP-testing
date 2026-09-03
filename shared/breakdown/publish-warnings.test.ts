/**
 * @module shared/breakdown/publish-warnings.test
 * @description PRD-50 FR-45 - FR-47: четыре ловушки выдачи, о которых автор узнаёт при
 * публикации. Предупреждения, а не запреты: публикация проходит в любом случае.
 */
import { describe, it, expect } from "vitest";
import { checkBreakdownPublish, type BreakdownPublishSection } from "./publish-warnings";

const section = (over: Partial<BreakdownPublishSection> = {}): BreakdownPublishSection => ({
  topicId: "law",
  topicName: "Право",
  drawCount: 3,
  drawAll: false,
  blueprint: null,
  variants: null,
  rules: null,
  questions: [
    { id: "q1", tags: ["ПДн"] },
    { id: "q2", tags: ["ПДн"] },
    { id: "q3", tags: ["Коррупция"] },
  ],
  ...over,
});

const codes = (sections: BreakdownPublishSection[]) => checkBreakdownPublish(sections).map((w) => w.code);

describe("checkBreakdownPublish", () => {
  it("молчит о разделе без ключей и без порогов", () => {
    expect(checkBreakdownPublish([section()])).toEqual([]);
  });

  it("сумма квот не равна выборке раздела (FR-45)", () => {
    const out = checkBreakdownPublish([
      section({ blueprint: { strata: [{ tag: "ПДн", count: 1 }] }, drawCount: 3 }),
    ]);
    expect(out[0]).toMatchObject({ code: "quota_sum_mismatch", count: 1, total: 3 });
  });

  it("есть вопросы без ключа, когда ключи в игре (FR-45)", () => {
    const out = checkBreakdownPublish([
      section({
        blueprint: { strata: [{ tag: "ПДн", count: 2 }, { tag: "Коррупция", count: 1 }] },
        questions: [
          { id: "q1", tags: ["ПДн"] },
          { id: "q2", tags: ["ПДн"] },
          { id: "q3", tags: ["Коррупция"] },
          { id: "q4", tags: [] },
        ],
      }),
    ]);
    expect(out.map((w) => w.code)).toContain("questions_without_key");
    expect(out.find((w) => w.code === "questions_without_key")!.count).toBe(1);
  });

  it("недостижимый порог больше не предупреждение — порог ничего не судит", () => {
    // Решение владельца 2026-09-03: порог ключа не гейт, поэтому и «недостижимым» он быть
    // не может. Прежнее предупреждение FR-46 снято вместе с гейтом.
    const out = checkBreakdownPublish([
      section({
        rules: { axis: "tag", keys: { "Коррупция": { type: "percent", value: 60 } } },
        variants: [
          { id: "f1", label: "Вариант 1", questionIds: ["q1"] },
          { id: "f2", label: "Вариант 2", questionIds: ["q2"] },
        ],
      }),
    ]);
    expect(out.map((w) => w.code)).not.toContain("threshold_key_never_delivered");
  });

  it("тест с сохранёнными порогами предупреждает о смене вердикта", () => {
    const out = checkBreakdownPublish([
      section({ rules: { axis: "tag", keys: { "ПДн": { type: "percent", value: 60 } } } }),
    ]);
    expect(out.map((w) => w.code)).toContain("key_thresholds_no_longer_gate");
    expect(out.find((w) => w.code === "key_thresholds_no_longer_gate")).toMatchObject({
      topicId: "law",
      topicName: "Право",
    });
  });

  it("без сохранённых порогов о смене вердикта не говорим", () => {
    expect(codes([section({ blueprint: { strata: [{ tag: "ПДн", count: 3 }] } })])).not.toContain(
      "key_thresholds_no_longer_gate",
    );
  });

  it("вопрос не входит ни в один вариант (FR-47)", () => {
    const out = checkBreakdownPublish([
      section({
        rules: { axis: "tag", default: { type: "percent", value: 60 } },
        variants: [{ id: "f1", label: "Вариант 1", questionIds: ["q1", "q2"] }],
      }),
    ]);
    expect(out.find((w) => w.code === "question_outside_variants")!.count).toBe(1);
  });

  it("заданы и квоты, и варианты — квоты не применяются (FR-47)", () => {
    const out = codes([
      section({
        blueprint: { strata: [{ tag: "ПДн", count: 2 }] },
        variants: [
          { id: "f1", label: "Вариант 1", questionIds: ["q1", "q2", "q3"] },
          { id: "f2", label: "Вариант 2", questionIds: ["q1", "q2", "q3"] },
        ],
      }),
    ]);
    expect(out).toContain("quotas_ignored_in_variants");
  });
});
