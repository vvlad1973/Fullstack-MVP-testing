/**
 * @module tests/breakdown-gate
 * @description Подтема ГОВОРИТ о результате, но не судит его (решение владельца
 * 2026-09-03): вердикт темы — это её собственное правило и ничего больше. Здесь
 * закреплено, что сохранённые пороги ключей вердикт не двигают, а запись разреза
 * вердикта не несёт вовсе; резольвер порогов остаётся — его читают перенос теста и
 * предупреждения публикации.
 */
import { describe, it, expect } from "vitest";
import { aggregateStandardResult, type AggregateSection } from "../shared/scoring/aggregate";
import { resolveBreakdownRules } from "../shared/scoring/pass-rule";

/** Один вопрос: цена `points`, ответ верен при `ok`. */
const q = (ok: boolean, tags: string[] | null, points = 1) => ({
  type: "single" as const,
  correct: { correctIndex: 0 },
  scoring: null,
  points,
  answer: ok ? 0 : 1,
  ...(tags ? { axisKeys: { tag: tags } } : {}),
});

const section = (
  topicId: string,
  questions: AggregateSection["questions"],
  extra: Partial<AggregateSection> = {},
): AggregateSection => ({
  topicId,
  topicName: topicId,
  topicPassRule: null,
  questions,
  ...extra,
});

describe("resolveBreakdownRules", () => {
  it("пустые и неопознанные правила означают отсутствие порогов", () => {
    expect(resolveBreakdownRules(null)).toBeNull();
    expect(resolveBreakdownRules({ axis: "tag" })).toBeNull();
    expect(resolveBreakdownRules("нет")).toBeNull();
  });

  it("явный «none» у ключа перебивает умолчание", () => {
    const rules = resolveBreakdownRules({
      axis: "tag",
      default: { type: "percent", value: 60 },
      keys: { "ПДн": { type: "none" } },
    });
    expect(rules).not.toBeNull();
    expect(rules!.byKey.get("ПДн")).toBeNull();
    expect(rules!.fallback).toBe(60);
  });
});

describe("вердикт темы не зависит от порогов подтем", () => {
  it("порог подтемы не роняет тему, у которой выполнено правило раздела", () => {
    const agg = aggregateStandardResult({
      sections: [
        section("law", [q(true, ["ПДн"]), q(true, ["ПДн"]), q(false, ["Коррупция"]), q(true, ["Коррупция"])], {
          topicPassRule: { source: "custom", type: "percent", value: 70 },
          // Сохранённый порог (легаси PRD-50 Э2): читается только переносом и
          // предупреждениями, на вердикт не влияет.
          breakdownRules: { axis: "tag", keys: { "Коррупция": { type: "percent", value: 80 } } },
        }),
      ],
      overallPassRule: { type: "percent", value: 70 },
    });
    expect(agg.topicResults[0].percent).toBe(75);
    expect(agg.topicResults[0].passed).toBe(true);
  });

  it("тема без собственного правила остаётся без вердикта, сколько бы порогов ни было задано", () => {
    const agg = aggregateStandardResult({
      sections: [
        section("law", [q(true, ["ПДн"], 1), q(false, ["ПДн"], 3)], {
          breakdownRules: { axis: "tag", default: { type: "percent", value: 40 } },
        }),
      ],
      overallPassRule: null,
    });
    expect(agg.topicResults[0].passed).toBeNull();
  });

  it("строки разреза считаются по-прежнему: доля вопросов и доля баллов расходятся", () => {
    // Дешёвый вопрос верен, дорогой — нет: доля вопросов 50 %, доля баллов 25 %.
    const agg = aggregateStandardResult({
      sections: [section("law", [q(true, ["ПДн"], 1), q(false, ["ПДн"], 3)])],
      overallPassRule: null,
    });
    const row = agg.topicResults[0].breakdown[0];
    expect(row.percentUnits).toBe(50);
    expect(row.percentPoints).toBe(25);
    expect("passed" in row).toBe(false);
  });

  it("вердикт темы держится на её правиле: 60 % при пороге 70 — не пройдено", () => {
    const agg = aggregateStandardResult({
      sections: [
        section(
          "law",
          [q(true, ["ПДн"]), q(true, ["ПДн"]), q(true, ["ПДн"]), q(false, ["ПДн"]), q(false, ["Коррупция"])],
          { topicPassRule: { source: "custom", type: "percent", value: 70 } },
        ),
      ],
      overallPassRule: null,
    });
    expect(agg.topicResults[0].percent).toBe(60);
    expect(agg.topicResults[0].passed).toBe(false);
  });

  it("записи области теста тоже без вердикта", () => {
    const agg = aggregateStandardResult({
      sections: [section("law", [q(false, ["ПДн"])])],
      overallPassRule: null,
    });
    expect("passed" in agg.breakdowns[0]).toBe(false);
  });
});
