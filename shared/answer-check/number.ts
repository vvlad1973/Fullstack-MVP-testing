/**
 * @module shared/answer-check/number
 *
 * The NUMERIC rule (PRD-57 §6.6): the learner types a number, the author compares it
 * with a tolerance. A numeric answer is a RULE, not a question type — the same short
 * answer and the same blank carry it.
 *
 * This stage (Э4) is the frame: the `eq` operator and a tolerance in units or in per
 * cent. The remaining operators, the inclusiveness of a range boundary and vulgar
 * fractions belong to Э5, so the parser rejects what it cannot yet honour instead of
 * guessing — a fraction read as «not a number» is a visible «не зачтено», a fraction
 * read wrongly is a silent one.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime.
 */

/** A numeric rule as stored in `questions.correct_json`. */
export interface NumericRule {
  kind: "number";
  op: "eq";
  value: number;
  tolerance?: { unit: "abs" | "pct"; value: number };
}

/** Spaces the learner may type inside a number, the non-breaking one included. */
const NUMBER_SPACES = /[\s   ]/g;

/**
 * Read the number the learner typed.
 *
 * Both decimal separators are accepted and spacing is ignored: AC-05f requires `3.14`,
 * `3,14` and ` 3,14 ` to behave identically. What the learner typed is stored and
 * reported to the LMS verbatim elsewhere — this is the comparison form only.
 *
 * @param value Raw input; anything that is not a string reads as absent.
 * @returns The finite number, or `null` when the input is not one.
 */
export function parseNumericAnswer(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(NUMBER_SPACES, "").replace(/−/g, "-").replace(",", ".");
  if (compact === "") return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(compact)) return null;
  const parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Does the answer satisfy the rule?
 *
 * A per-cent tolerance is taken from the ABSOLUTE value of the reference, so a negative
 * reference (-25 °C, and such a rule is expected — §6.6) keeps a positive window.
 *
 * @param rule   The numeric rule.
 * @param answer The learner's number, already parsed.
 * @returns True when the answer falls inside the tolerance window.
 */
export function matchNumber(rule: NumericRule, answer: number): boolean {
  if (!Number.isFinite(answer)) return false;
  const tolerance = rule.tolerance;
  const window = !tolerance
    ? 0
    : tolerance.unit === "pct"
      ? (Math.abs(rule.value) * tolerance.value) / 100
      : Math.abs(tolerance.value);
  return Math.abs(answer - rule.value) <= window;
}
