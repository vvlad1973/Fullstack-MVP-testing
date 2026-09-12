/**
 * @module shared/scoring/lms-score
 * @description What a finished run reports to the LMS as `cmi.score` (technical debt closed
 * 2026-09-12; discovered by the WebTutor export review, PRD-54 §14.1).
 *
 * One rule, one place, because the package has TWO finish paths — the adaptive one and the
 * standard one — and they used to send the score independently.
 */
import { nothingToGrade } from "./pass-rule";

/** The run, reduced to what the score decision actually reads. */
export interface LmsScoreInput {
  /** The run's percent, 0..100, as the results screen computes it. */
  percent: number;
  /**
   * The run's total possible points — zero when there was nothing to grade.
   *
   * `undefined` / `null` is UNKNOWN, not zero: an attempt restored from a record written by
   * an older package carries `percent` and no points at all.
   */
  possiblePoints: number | null | undefined;
}

/** `cmi.score.raw` out of `cmi.score.max`, or nothing to report at all. */
export interface LmsScore {
  raw: number;
  max: number;
}

/**
 * The score to send to the LMS, or `null` when the run has none to speak of.
 *
 * A measurement run (a questionnaire, an allocation of points — anything a threshold cannot
 * be applied to) passes by construction, and sending `raw = 0 / max = 100` alongside that
 * verdict makes the customer's report say «Пройден, 0 баллов» under a declared threshold.
 * SCORM 2004 allows `cmi.score` to be absent, so the honest answer is silence: the same
 * choice `buildTopicObjective` already makes one level down, for the objective of a
 * measurement topic.
 *
 * A graded run that earned ZERO still reports zero — the learner did answer wrongly, and
 * that is a measured fact rather than a missing measurement.
 *
 * Silence falls only on what is KNOWN to have nothing to grade. An attempt whose possible
 * points are unknown keeps its score: the figure is missing from records written by older
 * packages, and reading «unknown» as «nothing» would drop the score of every graded test
 * restored from one. The same asymmetry {@link hasPronouncedVerdict} makes for the verdict.
 */
export function lmsScoreFor(run: LmsScoreInput): LmsScore | null {
  const points = run.possiblePoints;
  const known = points !== null && points !== undefined;
  if (known && nothingToGrade(points)) return null;
  return { raw: Math.round(Number(run.percent) || 0), max: 100 };
}
