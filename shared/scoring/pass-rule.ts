/**
 * @module shared/scoring/pass-rule
 * @description Single source of pass-rule resolution + evaluation for BOTH hosts
 * (the web grader and the SCORM package runtime), PRD-18 unification. Topic rules
 * are authored as the editor `{source}` union; the overall rule as `{type,value}`.
 * This normalises EVERY shape to one runtime rule `{type:'percent'|'count', value}`
 * (or `null` = no gate) and applies the PRD-10 FR-10 basis: a `percent` rule
 * compares the points-based percent, a `count` rule compares Σ EARNED POINTS (NOT
 * the fully-correct question count).
 *
 * Replaces the two divergent inline implementations — `checkPassRuleWithPartial`
 * (resultsPage.js, Σ-points basis, no source handling) and the inline cast in
 * attempts.ts (correct-COUNT basis, no source handling) — both of which mis-graded
 * `inherit_overall` / `none` (treated as an unsatisfiable `value:undefined` count
 * rule, so the topic always failed) and disagreed on the count basis.
 *
 * PRD-50 adds the SECOND half of the topic gate here: the thresholds of the section's
 * breakdown keys ({@link applyBreakdownGate}). It lives next to the section rule for the
 * same reason the section rule lives here — one implementation for both hosts.
 */

import type { BreakdownEntry, BreakdownRules } from "../breakdown/types";

/** A resolved, runtime-ready pass rule. `null` means "no gate" (topic informational). */
export type ResolvedRule = { type: "percent" | "count"; value: number };

/**
 * How the overall threshold and the per-topic gates combine into the test verdict
 * (`tests.pass_decision_policy`). Semantics per
 * `docs/architecture/test-settings-parameter-structure.md` §3.4 and PRD-4 §5.2:
 *
 * - `overall_only`               — only the overall rule decides; topic results are informational.
 * - `overall_and_required_topics`— overall rule AND every REQUIRED topic's gate.
 * - `required_topics_only`       — every REQUIRED topic's gate; the overall result is informational.
 * - `all_topics_passed`          — every gated topic, required or not; overall informational.
 */
export type PassDecisionPolicy =
  | "overall_only"
  | "overall_and_required_topics"
  | "required_topics_only"
  | "all_topics_passed";

/**
 * Normalise a stored policy value. Returns `null` for anything unrecognised —
 * including a missing field, which is what a legacy attempt, a legacy publication
 * snapshot or a SCORM package built before the policy shipped carries. `null` is
 * NOT a synonym for a default policy: {@link aggregateStandardResult} keeps the
 * pre-policy verdict (overall rule AND every gated topic) for it, so grading such
 * data never changes retroactively.
 */
export function resolvePassDecisionPolicy(raw: unknown): PassDecisionPolicy | null {
  return raw === "overall_only" ||
    raw === "overall_and_required_topics" ||
    raw === "required_topics_only" ||
    raw === "all_topics_passed"
    ? raw
    : null;
}

/** Resolve the OVERALL pass rule (stored `{type:'percent'|'absolute'|'none', value}`). */
export function resolveOverallRule(raw: unknown): ResolvedRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { type?: string; value?: number };
  if (r.type === "none") return null;
  if (r.type === "percent") return { type: "percent", value: Number(r.value) || 0 };
  if (typeof r.value === "number") return { type: "count", value: r.value }; // 'absolute' / 'count'
  return null;
}

/**
 * Delivery context for topic-rule resolution (PRD-24). Carries what the learner
 * was actually given, so a rule can depend on it. Absent/empty = unknown delivery.
 */
export interface TopicRuleContext {
  /** Stable PRD-17 `formId` of the variant delivered for this topic in this attempt. */
  formId?: string | null;
}

/**
 * Resolve a TOPIC pass rule against the ALREADY-resolved overall rule.
 * - `{source:'inherit_overall'}` («Как у теста») → the overall rule (or `null` when
 *   the overall rule is «none»).
 * - `{source:'none'}` («Не проверять отдельно») → `null` (no gate, `passed` stays
 *   informational/null).
 * - `{source:'custom', type, value}` → `{type: percent|count, value}`.
 * - `{source:'by_variant', byForm}` (PRD-24) → the threshold of the DELIVERED variant
 *   (`ctx.formId`); when the variant is unknown or absent from the map, degrades to
 *   the overall rule (FR-09) — the topic stays gated rather than silently ungated.
 * - legacy `{type, value}` (pre-`source` data) → itself (`none` → `null`).
 * - `null`/`undefined`/non-object → `null` (no gate).
 */
export function resolveTopicRule(
  raw: unknown,
  overall: ResolvedRule | null,
  ctx?: TopicRuleContext,
): ResolvedRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    source?: string;
    type?: string;
    value?: number;
    byForm?: Record<string, { type?: string; value?: number }>;
  };
  if (r.source === "inherit_overall") return overall;
  if (r.source === "none") return null;
  if (r.source === "by_variant") {
    const entry = ctx?.formId ? r.byForm?.[ctx.formId] : undefined;
    if (!entry) return overall;
    return entry.type === "percent"
      ? { type: "percent", value: Number(entry.value) || 0 }
      : { type: "count", value: Number(entry.value) || 0 };
  }
  if (r.source === "custom") {
    return r.type === "percent"
      ? { type: "percent", value: Number(r.value) || 0 }
      : { type: "count", value: Number(r.value) || 0 };
  }
  // legacy direct `{type, value}` rule stored on the section
  if (r.type === "none") return null;
  if (r.type === "percent") return { type: "percent", value: Number(r.value) || 0 };
  if (typeof r.value === "number") return { type: "count", value: r.value };
  return null;
}

/**
 * Evaluate a resolved rule. A `null` rule passes (no gate). `percent` → the
 * points-based percent ≥ value; `count` → Σ earned points ≥ value (PRD-10 FR-10).
 */
export function checkPassRule(rule: ResolvedRule | null, percent: number, earnedScore: number): boolean {
  if (!rule) return true;
  if (rule.type === "percent") return percent >= rule.value;
  return earnedScore >= rule.value;
}

/** Round to one decimal — points show at most one fractional digit. */
function round1(n: number): number {
  return Math.round((Number(n) || 0) * 10) / 10;
}

/**
 * Was there anything to grade in this run at all (PRD-29 §6.7)?
 *
 * Read off the possible points, which every host already carries: a measurement
 * question has no correct grading, so it brings no points and never can. Deriving
 * it from the run itself also makes it true for attempts finished before the rule
 * existed — no migration, no new stored field.
 */
export function nothingToGrade(possiblePoints: number): boolean {
  return round1(possiblePoints) <= 0;
}

/**
 * Does this run carry a graded SCORE to speak about — the «сводка» gate of
 * PRD-29 §6.7? TWO conditions, not one: a threshold IS declared AND there is
 * something to grade. Every new test carries the default 70% threshold, so the
 * threshold alone would call a measurement questionnaire graded and put «0 %»,
 * «0 из 0 верно» and a 100% pass rate over a burnout inventory.
 *
 * An ABSENT flag is «unknown» and answers `false`: this gate only ever hides a
 * summary, and a number nobody can vouch for is worse than no number.
 *
 * @param thresholdDeclared Whether the test declares an overall pass threshold at
 *   all (`tests.overall_pass_rule_json.type !== 'none'`, i.e.
 *   {@link resolveOverallRule} returns a rule). `undefined` = unknown.
 * @param possiblePoints The run's total possible points.
 */
export function hasGradedScore(thresholdDeclared: boolean | undefined, possiblePoints: number): boolean {
  return thresholdDeclared === true && !nothingToGrade(possiblePoints);
}

/**
 * Was a VERDICT actually pronounced on this run (PRD-29 §6.7)?
 *
 * The same question as {@link hasGradedScore} with ONE deliberate difference: an
 * unknown threshold flag does NOT silence it. The summary gate may read unknown as
 * «no» because it only ever hides a number; the verdict is the headline, and a
 * caller that has not been taught to send the flag must not lose the verdict of
 * every graded test it shows. So this falls only on what is KNOWN: nothing was
 * graded, or the author declared no threshold at all.
 */
export function hasPronouncedVerdict(thresholdDeclared: boolean | undefined, possiblePoints: number): boolean {
  return !(nothingToGrade(possiblePoints) || thresholdDeclared === false);
}

// ─── PRD-50: gate by breakdown keys ──────────────────────────────────────────

/**
 * Normalised, runtime-ready key thresholds of ONE section. `fallback` is the threshold every
 * key without an own entry falls back to; `byKey` holds explicit entries, where a `null`
 * VALUE means «declared informational» and therefore WINS over the fallback (FR-20).
 */
export interface ResolvedBreakdownRules {
  axis: string;
  fallback: number | null;
  byKey: Map<string, number | null>;
}

/** One stored threshold → its percent value, or `null` for «none» / anything unrecognised. */
function breakdownThresholdValue(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as { type?: string; value?: unknown };
  if (t.type !== "percent") return null;
  const value = Number(t.value);
  return Number.isFinite(value) ? value : null;
}

/**
 * Normalise stored `test_sections.breakdown_rules_json` (any shape — validated on write, but
 * a legacy snapshot or an old SCORM package may carry none at all). Returns `null` when
 * NOTHING is declared: no fallback and no explicit key. `null` is the pre-PRD-50 state and
 * must leave the topic verdict exactly as it was.
 */
export function resolveBreakdownRules(raw: unknown): ResolvedBreakdownRules | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<BreakdownRules>;
  const byKey = new Map<string, number | null>();
  const keys = r.keys;
  if (keys && typeof keys === "object") {
    for (const key of Object.keys(keys)) byKey.set(key, breakdownThresholdValue(keys[key]));
  }
  const fallback = breakdownThresholdValue(r.default);
  if (fallback === null && byKey.size === 0) return null;
  return { axis: typeof r.axis === "string" && r.axis ? r.axis : "tag", fallback, byKey };
}

/** The threshold that applies to one key, or `null` when the key is informational (FR-20). */
export function breakdownThresholdFor(
  rules: ResolvedBreakdownRules | null,
  axis: string,
  key: string,
): number | null {
  if (!rules || axis !== rules.axis) return null;
  const own = rules.byKey.get(key);
  // `undefined` = no entry at all → fall back; an entry holding `null` is a deliberate «none».
  return own === undefined ? rules.fallback : own;
}

/**
 * Apply the key thresholds to ONE section's breakdown records (FR-19 - FR-22).
 *
 * Stamps `passed` on every record and answers the section's key verdict: `true` when every
 * applied threshold holds, `false` when at least one is missed, `null` when NO threshold
 * applied at all — no rules, only informational keys, or nothing delivered under the keys
 * that have one (FR-22). `null` must not be read as «passed»: the caller distinguishes «the
 * keys say nothing» from «the keys say yes».
 *
 * The records are mutated on purpose. They are the very objects both hosts persist with the
 * attempt and render from, so returning copies would mean threading a second array through
 * two hosts, the stored result and the report.
 */
export function applyBreakdownGate(entries: BreakdownEntry[], rawRules: unknown): boolean | null {
  const rules = resolveBreakdownRules(rawRules);
  let verdict: boolean | null = null;
  for (const e of entries) {
    const threshold = breakdownThresholdFor(rules, e.axis, e.key);
    // FR-22: a key nothing was delivered under cannot be missed, so it is not judged.
    if (threshold === null || e.items <= 0) {
      e.passed = null;
      continue;
    }
    // FR-21: ALWAYS the points share — the display basis must not move the verdict.
    const ok = e.percentPoints >= threshold;
    e.passed = ok;
    verdict = verdict === null ? ok : verdict && ok;
  }
  return verdict;
}
