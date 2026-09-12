/**
 * @module tests/lms-score
 * @description What the SCORM package reports to the LMS as `cmi.score` when the run had
 * NOTHING to grade (technical debt, ROADMAP §0.3; discovered by the WebTutor export review,
 * PRD-54 §14.1).
 *
 * The verdict of a measurement run is «passed» by construction — a run with nothing to grade
 * has no threshold to fall short of (PRD-26 FR-09) — but the score was sent anyway, as a flat
 * `raw = 0 / max = 100`. In the customer's report that reads as a failure: «Пройден» next to
 * «Баллы 0», under a declared 70 % threshold. One level down the same package is already
 * careful: `buildTopicObjective` omits the score block of a measurement topic deliberately.
 * These tests hold the root score to the same rule.
 */
import { describe, it, expect } from "vitest";
import { lmsScoreFor } from "@shared/scoring/lms-score";

describe("lmsScoreFor", () => {
  it("a graded run reports its percent out of 100", () => {
    expect(lmsScoreFor({ percent: 83, possiblePoints: 12 })).toEqual({ raw: 83, max: 100 });
  });

  it("a measurement run reports NO score at all", () => {
    // SCORM 2004 allows `cmi.score` to be absent; «0 of 100» is a claim we cannot make.
    expect(lmsScoreFor({ percent: 0, possiblePoints: 0 })).toBeNull();
  });

  it("rounds the percent the same way the results screen does", () => {
    expect(lmsScoreFor({ percent: 83.4, possiblePoints: 12 })).toEqual({ raw: 83, max: 100 });
    expect(lmsScoreFor({ percent: 83.5, possiblePoints: 12 })).toEqual({ raw: 84, max: 100 });
  });

  it("shares the «nothing to grade» threshold with the rest of scoring", () => {
    // Same rounding boundary as `nothingToGrade`: points show at most one decimal.
    expect(lmsScoreFor({ percent: 0, possiblePoints: 0.04 })).toBeNull();
    expect(lmsScoreFor({ percent: 50, possiblePoints: 0.05 })).toEqual({ raw: 50, max: 100 });
  });

  it("an UNKNOWN possible-points figure keeps the score", () => {
    // An attempt saved by an older package can carry `percent` and nothing else (the same
    // legacy shape `buildTopicObjective` degrades to). Unknown is not «nothing to grade»:
    // silencing on doubt would drop the score of every graded test restored from such a
    // record. The same asymmetry `hasPronouncedVerdict` already makes for the verdict.
    expect(lmsScoreFor({ percent: 62, possiblePoints: undefined })).toEqual({ raw: 62, max: 100 });
    expect(lmsScoreFor({ percent: 62, possiblePoints: null })).toEqual({ raw: 62, max: 100 });
  });

  it("a zero score on a graded run is still a score", () => {
    // The learner who answered everything wrong DID earn zero — that is a fact, not a gap.
    expect(lmsScoreFor({ percent: 0, possiblePoints: 10 })).toEqual({ raw: 0, max: 100 });
  });
});
