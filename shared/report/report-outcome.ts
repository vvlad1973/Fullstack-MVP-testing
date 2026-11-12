/**
 * @module shared/report/report-outcome
 *
 * Content of a report-document block that depends on the test OUTCOME.
 *
 * A block of the report document carries its common content (`values` for the fields the
 * template variant declares in `placeholders[]`, `settings` for its `settings[]`). The author
 * may additionally give the block content for a passed and for a failed run — the same three
 * positions the results-screen intro text has: «При любом исходе», «Если тест пройден»,
 * «Если тест не пройден».
 *
 * The outcome content is stored BESIDE the common one, never instead of it: the common
 * content is what a run without a pronounced verdict prints, so it must survive whatever the
 * author does to the outcome branches.
 *
 * Pure module: no DOM, no Node. It is imported by the schema, the server, the editor and the
 * SCORM runtime alike.
 */

/** The two outcomes a block can be tuned for. */
export const REPORT_OUTCOMES = ["passed", "failed"] as const;

/** One of {@link REPORT_OUTCOMES}. */
export type ReportOutcomeKey = (typeof REPORT_OUTCOMES)[number];

/** Content of a block for ONE outcome: only the fields and settings the author overrode. */
export interface ReportOutcomeContent {
  /** Field values keyed by placeholder key. */
  values?: Record<string, unknown>;
  /** Setting values keyed by setting key. */
  settings?: Record<string, unknown>;
}

/**
 * Outcome content of a block, as the `report_blocks.outcome_json` column stores it.
 *
 * An absent branch means «nothing overridden for this outcome»: the block prints its common
 * content for it.
 */
export type ReportBlockOutcome = Partial<Record<ReportOutcomeKey, ReportOutcomeContent>>;

/** Is `value` a plain object (not an array, not null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Bring an arbitrary value to the {@link ReportBlockOutcome} shape.
 *
 * Unknown keys are dropped at every level, and empty branches are dropped too, so that
 * «nothing set» has exactly one representation — `{}`. One representation matters: the
 * editor marks a row as having outcome content by the mere presence of a branch, and the
 * snapshot drift check compares the stored JSON.
 *
 * @param raw Anything: the request body, a database row, a baked package field.
 * @returns A normalized outcome object; `{}` when nothing usable is present.
 */
export function normalizeReportBlockOutcome(raw: unknown): ReportBlockOutcome {
  if (!isRecord(raw)) return {};
  const out: ReportBlockOutcome = {};
  for (const key of REPORT_OUTCOMES) {
    const branch = raw[key];
    if (!isRecord(branch)) continue;
    const content: ReportOutcomeContent = {};
    if (isRecord(branch.values) && Object.keys(branch.values).length) content.values = { ...branch.values };
    if (isRecord(branch.settings) && Object.keys(branch.settings).length) content.settings = { ...branch.settings };
    if (content.values || content.settings) out[key] = content;
  }
  return out;
}

/**
 * Field types whose outcome text is APPENDED to the common one instead of replacing it.
 *
 * These are the long texts: the author writes a common lead and adds a word for the passed or
 * the failed learner, exactly as the results-screen intro text works. Every other field type
 * (a short line, an image, a result field) is a single value, and an outcome value replaces it.
 */
export const APPENDED_FIELD_TYPES: readonly string[] = ["html", "richText", "textarea"];

/** Is the value empty for printing purposes. */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** What {@link applyReportBlockOutcome} needs to know about a block. */
export interface OutcomeTarget {
  /** Common field values. */
  values: Record<string, unknown>;
  /** Common setting values. */
  settings: Record<string, unknown>;
  /** Declared fields of the block's variant: their types decide append vs replace. */
  placeholders: ReadonlyArray<{ key: string; type: string }>;
  /** The block's outcome content. */
  outcome?: unknown;
}

/**
 * The values and settings a block prints for a given outcome.
 *
 * Rules (owner decision 2026-11-12):
 *   - no pronounced verdict (`which` is empty) — the common content, untouched;
 *   - a long text ({@link APPENDED_FIELD_TYPES}) — the common text followed by the outcome
 *     text; a blank common text yields the outcome text alone, a blank outcome text adds
 *     nothing;
 *   - any other field and every setting — the outcome value replaces the common one; a value
 *     not set for the outcome falls back to the common one.
 *
 * Pure and shared by every host — the web PDF, the SCORM package and the editor preview all
 * reach it through `renderReportInto`, so none of them can decide differently.
 *
 * @param target The block's common content, declared fields and outcome content.
 * @param which The outcome of the run; `""` (or anything else) when no verdict is pronounced.
 * @returns New objects; the input is never mutated.
 */
export function applyReportBlockOutcome(
  target: OutcomeTarget,
  which: string,
): { values: Record<string, unknown>; settings: Record<string, unknown> } {
  const values = { ...target.values };
  const settings = { ...target.settings };
  if (which !== "passed" && which !== "failed") return { values, settings };
  const branch = normalizeReportBlockOutcome(target.outcome)[which];
  if (!branch) return { values, settings };

  const typeOf = new Map(target.placeholders.map((p) => [p.key, p.type]));
  for (const [key, value] of Object.entries(branch.values ?? {})) {
    if (isBlank(value)) continue;
    const type = typeOf.get(key) ?? "text";
    if (APPENDED_FIELD_TYPES.includes(type) && !isBlank(values[key])) {
      // A plain multi-line text keeps its paragraphs apart with an empty line; markup is
      // simply concatenated — each part is a complete fragment of its own.
      values[key] = type === "textarea" ? `${String(values[key])}\n\n${String(value)}` : `${String(values[key])}${String(value)}`;
    } else {
      values[key] = value;
    }
  }
  for (const [key, value] of Object.entries(branch.settings ?? {})) {
    if (value === null || value === undefined) continue;
    settings[key] = value;
  }
  return { values, settings };
}

/**
 * Does the block carry any outcome content.
 *
 * @param outcome The block's outcome content in any shape.
 * @returns `true` when at least one branch overrides at least one field or setting.
 */
export function hasReportBlockOutcome(outcome: unknown): boolean {
  return Object.keys(normalizeReportBlockOutcome(outcome)).length > 0;
}
