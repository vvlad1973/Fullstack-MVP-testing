/**
 * @module server/services/result-compute
 *
 * Pure orchestration of the graded result namespaces — scales (PRD-5) and result
 * variables (PRD-2) — for the web learner runtime (PRD-12 Phase 2). It reuses the
 * authoritative `@shared` engines, the same ones the SCORM package runs, so the
 * web and SCORM produce identical numbers (PRD-12 §3.5). The compute order mirrors
 * the SCORM runtime (server/scorm/template/app/render/resultsPage.js): scales first
 * (so result-variable formulas can read `scale.*`), then the variables.
 *
 * This module is storage-free (unit-testable without a DB). The DB->spec config
 * loading lives in {@link module:server/services/scoring-config} (loadScoringConfig).
 */

import {
  computeScales,
  type ScaleSpec,
  type MeasurementSpec,
  type QuestionType,
  type Answer,
} from "@shared/scales/engine";
import { computeResultVariables, type ResultVariableSpec } from "@shared/formula/result-variables";
import type { AllocationSpec } from "@shared/questions/allocation";
import type { EvalContext, FormulaValue, ScaleResult } from "@shared/formula/types";
import type { BreakdownEntry } from "@shared/breakdown/types";

/** A test's graded-scoring configuration, mapped to the `@shared` engine specs. */
export interface ScoringConfig {
  scales: ScaleSpec[];
  measurements: MeasurementSpec[];
  resultVariables: ResultVariableSpec[];
  /**
   * PRD-44: allocation spec of every budget question that feeds a scale, keyed by question
   * id. It travels WITH the scoring configuration rather than as a separate argument for a
   * reason: the budget bounds the scale's domain, so it is as much a part of «how this test
   * is scored» as the measurements are, and callers that never heard of the type keep
   * working. Empty for a test without budget questions.
   */
  budgets: Record<string, AllocationSpec>;
}

/** The computed graded namespaces for one attempt. */
export interface AttemptComputation {
  scaleResults: Record<string, ScaleResult>;
  resultVariables: Record<string, FormulaValue>;
  status: { success?: boolean; completion?: boolean };
}

/** Per-topic inputs the result-variable context needs (`percent`, `topicById`). */
export interface AttemptResultBase {
  percent: number;
  topicResults: Array<{
    topicId: string;
    percent: number;
    passed: boolean | null;
    earnedPoints: number;
    /** Topic display name — keys `topicByName(...)`. */
    topicName?: string;
    /** Author-defined readable id — additional key for `topicById(...)`. */
    code?: string | null;
  }>;
  /**
   * PRD-50: this attempt's breakdown records, BOTH scopes in one flat array (the test
   * scope from `AggregateResult.breakdowns`, the section scopes from every
   * `AggregateTopicResult.breakdown`). Absent = no keys were delivered, and `tag()`
   * then keeps resolving to neutral defaults.
   */
  breakdowns?: BreakdownEntry[];
}

/**
 * Computes `scale.*` then `result.*` for an attempt, mirroring the SCORM runtime
 * order: scales first so result-variable formulas can read `scaleById()` /
 * `countScales()`, then the variables. Deterministic — the same answers always
 * yield the same output (NFR-04). `tags` is fed from the attempt's PRD-50 breakdown
 * records and `sections` from the per-topic results, exactly as the SCORM runtime
 * fills them (`buildResultVarContext`).
 */
export function computeAttemptResult(
  config: ScoringConfig,
  answers: Record<string, Answer>,
  questionTypes: Record<string, QuestionType>,
  base: AttemptResultBase,
): AttemptComputation {
  const scaleComputation = config.scales.length
    ? computeScales(config.scales, config.measurements, answers, questionTypes, config.budgets ?? {})
    : { values: {} as Record<string, ScaleResult>, errors: [] };

  // Topics are keyed by UUID and (when set) the author's custom code, so
  // `topicById(...)` accepts either; names key `topicByName(...)`.
  const topics: EvalContext["topics"] = {};
  const topicsByName: NonNullable<EvalContext["topicsByName"]> = {};
  for (const tr of base.topicResults) {
    const r = { percent: tr.percent || 0, passed: tr.passed === true, score: tr.earnedPoints || 0 };
    topics[tr.topicId] = r;
    if (tr.code) topics[tr.code] = r;
    if (tr.topicName) topicsByName[tr.topicName] = r;
  }

  // PRD-50 FR-35/FR-36: `tag(...)` reads the breakdown records of this attempt. The test
  // scope keeps the plain key; a section scope is addressed by the COMPOSITE key
  // «<section>::<key>», where the section part accepts the same two spellings
  // `topicById` does — its UUID and the author's code. The grammar is untouched.
  const tags: EvalContext["tags"] = {};
  const sectionAliases = new Map<string, string[]>();
  for (const tr of base.topicResults) {
    sectionAliases.set(tr.topicId, tr.code ? [tr.topicId, tr.code] : [tr.topicId]);
  }
  for (const e of base.breakdowns ?? []) {
    // `percent` is the POINTS-based ratio: it is the verdict currency (FR-21) and must
    // not depend on which basis the author chose to display on screen.
    const value = { percent: e.percentPoints, score: e.earned, maxScore: e.possible, count: e.items };
    if (e.scope === "test") {
      tags[e.key] = value;
      continue;
    }
    const sectionId = e.scope.slice("section:".length);
    for (const alias of sectionAliases.get(sectionId) ?? [sectionId]) {
      tags[alias + "::" + e.key] = value;
    }
  }

  // `sectionById(...)` is the delivered section = the topic result, keyed by UUID and by
  // the author's code. `completed` is true by construction: a section that produced a
  // result was played to its end in the standard flow.
  const sections: EvalContext["sections"] = {};
  for (const tr of base.topicResults) {
    const value = { percent: tr.percent || 0, passed: tr.passed === true, completed: true };
    sections[tr.topicId] = value;
    if (tr.code) sections[tr.code] = value;
  }

  const evalBase: Omit<EvalContext, "vars"> = {
    percent: base.percent || 0,
    // Overall earned points across the test = Σ of per-topic earned points.
    score: base.topicResults.reduce((sum, tr) => sum + (tr.earnedPoints || 0), 0),
    topics,
    topicsByName,
    tags,
    scales: scaleComputation.values,
    sections,
  };

  const resultComputation = config.resultVariables.length
    ? computeResultVariables(config.resultVariables, evalBase)
    : { values: {} as Record<string, FormulaValue>, errors: [], status: {} as AttemptComputation["status"] };

  return {
    scaleResults: scaleComputation.values,
    resultVariables: resultComputation.values,
    status: resultComputation.status,
  };
}
