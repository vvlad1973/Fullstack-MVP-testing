/**
 * @module tests/report-block-outcome-layouts
 *
 * The standard template prints a system block's own title and lead, and their outcome
 * variants, through the REAL layouts — and prints nothing new when the author left them empty.
 *
 * The parity test (`report-document-parity.test.ts`) already proves the untouched document is
 * unchanged; this file proves the new fields actually reach the page.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderReportInto } from "@shared/report/render-report";
import { resolveReportDocument, type ReportBlockRowInput } from "@shared/report/report-document";
import { buildReportFixtureContext } from "./helpers/report-fixture";

const DIR = path.resolve(__dirname, "../server/scorm/templates/default");
const read = (p: string): string => fs.readFileSync(path.join(DIR, p), "utf8");
const MANIFEST = JSON.parse(read("manifest.json"));

/** Render the standard document with one recommendations row and the given outcome. */
function render(row: Partial<ReportBlockRowInput>, outcome: "" | "passed" | "failed"): HTMLElement {
  const base = buildReportFixtureContext(MANIFEST) as { report: Record<string, unknown> };
  const context = { ...base, report: { ...base.report, outcome } };
  const doc = resolveReportDocument(MANIFEST, "report", [
    { block: "recommendations", sortOrder: 0, enabled: true, templateKey: null, valuesJson: {}, settingsJson: {}, ...row },
  ]);
  const stage = document.createElement("div");
  renderReportInto(stage, {
    shell: read("layouts/report/shell.html"),
    context,
    blocks: doc.blocks.filter((b) => b.block === "recommendations").map((b) => ({ ...b, layout: read(b.layoutFile) })),
  });
  return stage;
}

const titleOf = (el: HTMLElement) => el.querySelector(".tb-report__title")?.textContent?.trim();

describe("own title and lead of a system block in the standard template", () => {
  it("prints the label when the author left the title empty", () => {
    const el = render({}, "passed");
    expect(titleOf(el)).toBeTruthy();
    expect(el.querySelector('[data-placeholder="lead"]')).toBeNull();
  });

  it("prints the author's title instead of the label, and the lead", () => {
    const el = render({ valuesJson: { title: "Что дальше", lead: "<p>Общее слово</p>" } }, "");
    expect(titleOf(el)).toBe("Что дальше");
    expect(el.querySelectorAll(".tb-report__title")).toHaveLength(1);
    expect(el.textContent).toContain("Общее слово");
  });

  it("prints the outcome title and appends the outcome lead", () => {
    const row = {
      valuesJson: { title: "Что дальше", lead: "<p>Общее слово</p>" },
      outcomeJson: {
        passed: { values: { lead: "<p>Так держать</p>" } },
        failed: { values: { title: "Над чем поработать" } },
      },
    };
    const passed = render(row, "passed");
    expect(titleOf(passed)).toBe("Что дальше");
    expect(passed.textContent).toContain("Общее слово");
    expect(passed.textContent).toContain("Так держать");

    const failed = render(row, "failed");
    expect(titleOf(failed)).toBe("Над чем поработать");
    expect(failed.textContent).not.toContain("Так держать");
  });
});
