/**
 * @module shared/answer-check/rules
 *
 * The SET of comparison rules an open answer is checked against (PRD-57 §6.1) — the
 * single engine behind the short answer (§6.5) and, from Э8 on, every blank (FR-24c).
 *
 * Shape decisions, all taken by the owner on 2026-09-18 and recorded as requirements:
 * the answer KIND is a property of the question, not of a rule (FR-28d) — text and
 * number never stand side by side, because a rule of the other kind could not fire once;
 * the JOIN is one per set (FR-28c) — mixing «и» with «или» would need brackets, and
 * brackets turn a list into an expression builder the track walks away from.
 *
 * An EMPTY set is not an error: it means the author has not written the check yet. It
 * matches nothing, and {@link hasRules} is what callers ask before treating the question
 * as graded at all — the same way a keyless scale is measurement-only.
 *
 * `match: "regex"` is part of the STORED shape but is never satisfied here. The regular
 * expression arrives in Э7 together with the runtime budget it cannot ship without
 * (FR-28q); until then a rule that says `regex` fires for nobody rather than running
 * unbudgeted.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime.
 */
import { normalizeForCompare } from "./normalize";
import { matchWildcard } from "./wildcard";
import { matchNumber, parseNumericAnswer, type NumericRule } from "./number";

/** A textual rule: ordinary comparison today, a regular expression from Э7. */
export interface TextRule {
  kind: "text";
  match: "wildcard" | "regex";
  value: string;
}

/** One rule of either kind. */
export type AnswerRule = TextRule | NumericRule;

/** The whole check of one question (or, from Э8, of one blank). */
export interface AnswerRuleSet {
  answerKind: "text" | "number";
  join: "any" | "all";
  rules: AnswerRule[];
  /** Display unit shown beside the learner's field, e.g. `°C`; never typed by them. */
  unit?: string;
}

/** The verdict plus which rules fired — the list drives the Э6 probe marks. */
export interface RuleSetOutcome {
  passed: boolean;
  perRule: boolean[];
}

/** Does this set actually check anything? */
export function hasRules(set: AnswerRuleSet | null | undefined): boolean {
  return !!set && Array.isArray(set.rules) && set.rules.length > 0;
}

/** Apply one rule to an answer that has already been prepared for its kind. */
function matchOne(rule: AnswerRule, text: string, numeric: number | null): boolean {
  if (rule.kind === "number") {
    return numeric === null ? false : matchNumber(rule, numeric);
  }
  if (rule.match !== "wildcard") return false;
  return matchWildcard(normalizeForCompare(rule.value), text);
}

/**
 * Check a learner's answer against the whole set.
 *
 * An empty answer never passes: a set whose pattern is a bare `*` would otherwise award
 * the question to someone who typed nothing.
 *
 * @param set    The author's rules.
 * @param answer The learner's raw input.
 * @returns The verdict and the per-rule outcomes, in the authored order.
 */
export function checkRuleSet(set: AnswerRuleSet, answer: string | null | undefined): RuleSetOutcome {
  const rules = Array.isArray(set?.rules) ? set.rules : [];
  const text = normalizeForCompare(answer);
  if (rules.length === 0 || text === "") {
    return { passed: false, perRule: rules.map(() => false) };
  }
  const numeric = set.answerKind === "number" ? parseNumericAnswer(answer) : null;
  const perRule = rules.map((rule) => matchOne(rule, text, numeric));
  const passed = set.join === "all" ? perRule.every(Boolean) : perRule.some(Boolean);
  return { passed, perRule };
}
