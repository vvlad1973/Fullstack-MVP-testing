/**
 * @module tests/breakdown-snapshot-freeze
 * @description PRD-50 FR-38: снимок публикации несёт настройки разреза и словарь надписей.
 *
 * Кода под это требование нет и не нужно: снимок морозит строку `tests` и строки
 * `test_sections` целиком, поэтому и `breakdown_display_json`, и `design_settings_json`,
 * и будущие `section_groups_json` (Э3) и `breakdown_rules_json` (Э2) едут туда сами. Этот
 * файл — страж ровно этого свойства: «выбрать только нужные колонки» выглядит безобидной
 * оптимизацией и снимает требование молча.
 */
import { describe, it, expect, vi } from "vitest";

const testRow = {
  id: "t1",
  title: "Сертификация",
  mode: "standard",
  version: 3,
  breakdownDisplayJson: { visibility: "bar_and_value", basis: "units" },
  designSettingsJson: { templateId: "default", labels: { results: { "topic.verdict.passed": "Зачёт" } } },
  // Колонка, о которой сборщик снимка не знает ничего: стоит здесь как заместитель
  // будущих `section_groups_json` и любых следующих. Она обязана доехать так же.
  someFutureColumnJson: { kept: true },
};

const sectionRow = {
  id: "s1",
  testId: "t1",
  topicId: "tp1",
  drawCount: 1,
  someFutureSectionColumnJson: { kept: true },
};

vi.mock("../server/services/scale-domain", () => ({ materializeScaleDomains: vi.fn() }));
vi.mock("../server/storage", () => ({
  storage: {
    getTest: vi.fn(async () => testRow),
    getTestSections: vi.fn(async () => [sectionRow]),
    getTopics: vi.fn(async () => [{ id: "tp1", name: "Тема" }]),
    getScales: vi.fn(async () => []),
    getQuestionMeasurements: vi.fn(async () => []),
    getResultVariables: vi.fn(async () => []),
    getContentPages: vi.fn(async () => []),
    getTestQuestionScoring: vi.fn(async () => []),
    getQuestionsByTopic: vi.fn(async () => []),
    getTopicCourses: vi.fn(async () => []),
    getTopicEvents: vi.fn(async () => []),
  },
}));

import { buildSnapshotContent, snapshotDataSource } from "../server/services/test-snapshot";
import type { TestSnapshotContent } from "../server/services/test-snapshot";

describe("снимок публикации и настройки разреза (FR-38)", () => {
  it("морозит строку теста ЦЕЛИКОМ, включая колонки, о которых сборщик не знает", async () => {
    const content = (await buildSnapshotContent("t1")) as TestSnapshotContent;
    expect(content.test).toEqual(testRow);
    expect(content.sections[0]).toEqual(sectionRow);
  });

  it("выдача читает настройку показа и словарь надписей ИЗ снимка", async () => {
    const content = (await buildSnapshotContent("t1")) as TestSnapshotContent;
    const frozen = await snapshotDataSource(content).getTest("t1");
    expect((frozen as never as typeof testRow).breakdownDisplayJson).toEqual({
      visibility: "bar_and_value",
      basis: "units",
    });
    expect((frozen as never as typeof testRow).designSettingsJson.labels.results["topic.verdict.passed"])
      .toBe("Зачёт");
  });
});
