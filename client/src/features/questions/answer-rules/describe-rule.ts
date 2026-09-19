/**
 * @module features/questions/answer-rules/describe-rule
 *
 * A numeric rule said in words (PRD-57 FR-28aa2): the operator gives the constructor its
 * compactness, the sentence below it gives the author something to proof-read — «от -27
 * до -23 °C» is checkable at a glance, `= -25 ± 2` has to be converted in the head first.
 *
 * It lives on the CLIENT rather than in `shared/answer-check/`: the wording is written for
 * the AUTHOR, the learner never sees it, and the comparison modules are bundled into every
 * SCORM package — text that nobody in the package reads has no business travelling there.
 * The probe of Э6 and the blanks of Э8 read the same wording from here.
 */
import type { NumericOp, NumericRule } from "@shared/answer-check";

/** The operator list of the approved wireframe, in its order. */
export const NUMERIC_OPERATORS: Array<{ value: NumericOp; label: string }> = [
  { value: "eq", label: "равно" },
  { value: "ne", label: "не равно" },
  { value: "gt", label: "больше" },
  { value: "gte", label: "больше или равно" },
  { value: "lt", label: "меньше" },
  { value: "lte", label: "меньше или равно" },
];

/** Does this operator honour a tolerance? Only equality does (§6.6). */
export function hasTolerance(op: NumericOp): boolean {
  return op === "eq" || op === "ne";
}

/**
 * Print a number the way the author typed it, not the way JavaScript stores it.
 *
 * Six decimals is where a third (`0,333333`) still reads as a third and the floating-point
 * dust of `3,09` (which arrives as `3.0900000000000003`) is already gone.
 *
 * @param value Any finite number.
 * @returns The Russian spelling: a comma, no trailing zeros.
 */
export function formatRuleNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toFixed(6))).replace(".", ",");
}

/** Half-width of the window around the value; zero when the operator ignores a tolerance. */
function windowOf(rule: NumericRule): number {
  const tolerance = rule.tolerance;
  if (!tolerance || !hasTolerance(rule.op)) return 0;
  return tolerance.unit === "pct" ? (Math.abs(rule.value) * tolerance.value) / 100 : Math.abs(tolerance.value);
}

/** ` °C` — or nothing at all, so a rule without a unit does not end in a space. */
function suffix(unit: string): string {
  const trimmed = (unit ?? "").trim();
  return trimmed === "" ? "" : ` ${trimmed}`;
}

/** The word for the operator, as the select spells it. */
function operatorLabel(op: NumericOp): string {
  return NUMERIC_OPERATORS.find((item) => item.value === op)?.label ?? "равно";
}

/**
 * Title of a COLLAPSED rule row — what this rule checks, in one line (FR-28b).
 *
 * @param rule The numeric rule.
 * @param unit Display unit of the answer, `""` when the question has none.
 */
export function numericRuleTitle(rule: NumericRule, unit: string): string {
  const head = `${operatorLabel(rule.op)} ${formatRuleNumber(rule.value)}${suffix(unit)}`;
  if (!rule.tolerance || !hasTolerance(rule.op)) return head;
  const measure = rule.tolerance.unit === "pct" ? " %" : "";
  return `${head} ±${formatRuleNumber(rule.tolerance.value)}${measure}`;
}

/**
 * The rule in plain words, shown under the condition (FR-28aa2).
 *
 * A tolerance is always spelled out as BOUNDARIES: «± 2 %» still leaves the author
 * counting, and counting is exactly what the sentence is here to spare them.
 *
 * @param rule The numeric rule.
 * @param unit Display unit of the answer, `""` when the question has none.
 */
export function describeNumericRule(rule: NumericRule, unit: string): string {
  const tail = suffix(unit);
  const value = formatRuleNumber(rule.value);
  const window = windowOf(rule);
  const low = formatRuleNumber(rule.value - window);
  const high = formatRuleNumber(rule.value + window);

  switch (rule.op) {
    case "ne":
      return window === 0
        ? `Засчитывается любой ответ, кроме ${value}${tail}`
        : `Засчитывается любой ответ, кроме значений от ${low} до ${high}${tail}`;
    case "gt":
      return `Засчитывается ответ больше ${value}${tail}`;
    case "gte":
      return `Засчитывается ответ не меньше ${value}${tail}`;
    case "lt":
      return `Засчитывается ответ меньше ${value}${tail}`;
    case "lte":
      return `Засчитывается ответ не больше ${value}${tail}`;
    case "eq":
    default:
      return window === 0
        ? `Засчитывается ответ ровно ${value}${tail}`
        : `Засчитывается ответ от ${low} до ${high}${tail}`;
  }
}
