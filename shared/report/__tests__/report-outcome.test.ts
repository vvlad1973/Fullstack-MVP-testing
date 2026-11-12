/**
 * @module shared/report/__tests__/report-outcome
 * @description Canonical shape of a report block's outcome content.
 */
import { describe, it, expect } from "vitest";
import { applyReportBlockOutcome, hasReportBlockOutcome, normalizeReportBlockOutcome } from "../report-outcome";

describe("normalizeReportBlockOutcome", () => {
  it("keeps the passed and failed branches with their values and settings", () => {
    const raw = {
      passed: { values: { title: "Так держать" } },
      failed: { values: { lead: "<p>Поработайте</p>" }, settings: { topics: "failed" } },
    };
    expect(normalizeReportBlockOutcome(raw)).toEqual(raw);
  });

  it("drops unknown keys at both levels", () => {
    expect(
      normalizeReportBlockOutcome({
        passed: { values: { title: "A" }, extra: 1 },
        neutral: { values: { title: "B" } },
      }),
    ).toEqual({ passed: { values: { title: "A" } } });
  });

  it("drops empty branches so that «nothing set» is always {}", () => {
    expect(normalizeReportBlockOutcome({ passed: { values: {} }, failed: {} })).toEqual({});
  });

  it.each([null, undefined, "x", 1, [], [{ passed: {} }]])("returns {} for %p", (raw) => {
    expect(normalizeReportBlockOutcome(raw)).toEqual({});
  });

  it("does not share objects with the input", () => {
    const values = { title: "A" };
    const out = normalizeReportBlockOutcome({ passed: { values } });
    out.passed!.values!.title = "B";
    expect(values.title).toBe("A");
  });
});

describe("hasReportBlockOutcome", () => {
  it("is true only when at least one value is overridden", () => {
    expect(hasReportBlockOutcome({})).toBe(false);
    expect(hasReportBlockOutcome({ passed: { values: {} } })).toBe(false);
    expect(hasReportBlockOutcome({ failed: { settings: { topics: "failed" } } })).toBe(true);
  });
});

describe("applyReportBlockOutcome", () => {
  const placeholders = [
    { key: "title", type: "text" },
    { key: "lead", type: "html" },
    { key: "note", type: "textarea" },
  ];
  const target = {
    values: { title: "Рекомендации", lead: "<p>Общее</p>", note: "Общее" },
    settings: { topics: "all" },
    placeholders,
    outcome: {
      passed: { values: { lead: "<p>Так держать</p>" } },
      failed: { values: { title: "Над чем поработать", note: "Повторите" }, settings: { topics: "failed" } },
    },
  };

  it("prints the common content when no verdict is pronounced", () => {
    expect(applyReportBlockOutcome(target, "")).toEqual({ values: target.values, settings: target.settings });
  });

  it("appends a long text after the common one", () => {
    const { values } = applyReportBlockOutcome(target, "passed");
    expect(values.lead).toBe("<p>Общее</p><p>Так держать</p>");
    expect(values.title).toBe("Рекомендации");
  });

  it("keeps the paragraphs of a plain multi-line text apart", () => {
    expect(applyReportBlockOutcome(target, "failed").values.note).toBe("Общее\n\nПовторите");
  });

  it("replaces a short field and a setting", () => {
    const { values, settings } = applyReportBlockOutcome(target, "failed");
    expect(values.title).toBe("Над чем поработать");
    expect(settings.topics).toBe("failed");
  });

  it("prints the outcome text alone when the common one is blank", () => {
    const { values } = applyReportBlockOutcome({ ...target, values: { lead: "  " } }, "passed");
    expect(values.lead).toBe("<p>Так держать</p>");
  });

  it("ignores a blank outcome value", () => {
    const { values } = applyReportBlockOutcome(
      { ...target, outcome: { failed: { values: { title: "", lead: "" } } } },
      "failed",
    );
    expect(values.title).toBe("Рекомендации");
    expect(values.lead).toBe("<p>Общее</p>");
  });

  it("treats an undeclared field as a short one", () => {
    const { values } = applyReportBlockOutcome(
      { values: { extra: "A" }, settings: {}, placeholders: [], outcome: { passed: { values: { extra: "B" } } } },
      "passed",
    );
    expect(values.extra).toBe("B");
  });

  it("does not mutate the input", () => {
    applyReportBlockOutcome(target, "failed");
    expect(target.values.title).toBe("Рекомендации");
  });
});
