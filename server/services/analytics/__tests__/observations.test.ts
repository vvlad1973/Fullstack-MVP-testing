/**
 * @module server/services/analytics/__tests__/observations
 * @description PRD-56 FR-33: one shape for a passage, whatever it came from.
 *
 * The tests describe the NORMALISATION only — reading rows from the database is the
 * next task and is covered by an integration test on pglite. What matters here is
 * that a web attempt and a telemetry row carrying the same run produce the same
 * `Observation`, because the whole point of the layer is that the two screens stop
 * disagreeing about the same passage (FR-25).
 */

import { describe, expect, it } from "vitest";

import { toObservation } from "../observations";

const TEST_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

const users = new Map([[USER_ID, { name: "Морозова Анна" }]]);
const packages = new Map([["pkg-1", { testId: TEST_ID }]]);

/** A graded web attempt: finished, scored, verdict pronounced. */
function webAttempt(over: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    userId: USER_ID,
    testId: TEST_ID,
    snapshotId: "snap-1",
    variantJson: { formId: "form-A" },
    resultJson: { overallPercent: 78, overallPassed: true, totalPossiblePoints: 20 },
    startedAt: new Date("2026-09-11T14:00:00Z"),
    finishedAt: new Date("2026-09-11T14:20:00Z"),
    ...over,
  };
}

/** The same run as it arrives through SCORM telemetry. */
function lmsAttempt(over: Record<string, unknown> = {}) {
  return {
    id: "scorm-1",
    packageId: "pkg-1",
    testId: TEST_ID,
    origin: "telemetry" as const,
    userId: USER_ID,
    participantKey: null,
    groupId: null,
    lmsUserName: null,
    resultPercent: 78,
    resultPassed: true,
    maxPoints: 20,
    startedAt: new Date("2026-09-11T14:00:00Z"),
    finishedAt: new Date("2026-09-11T14:20:00Z"),
    ...over,
  };
}

describe("toObservation — web and telemetry describe one passage the same way", () => {
  it("gives a web attempt and its telemetry twin the same observation", () => {
    const fromWeb = toObservation.web(webAttempt(), { users, gradedTest: true });
    const fromLms = toObservation.lms(lmsAttempt(), { users, packages, gradedTest: true });

    expect(fromWeb.testId).toBe(fromLms.testId);
    expect(fromWeb.participant).toBe(fromLms.participant);
    expect(fromWeb.percent).toBe(fromLms.percent);
    expect(fromWeb.passed).toBe(fromLms.passed);
    expect(fromWeb.outcome).toBe(fromLms.outcome);
    expect(fromWeb.durationMs).toBe(fromLms.durationMs);
  });

  it("marks the source of each row", () => {
    expect(toObservation.web(webAttempt(), { users, gradedTest: true }).source).toBe("web");
    expect(toObservation.lms(lmsAttempt(), { users, packages, gradedTest: true }).source)
      .toBe("telemetry");
    expect(
      toObservation.lms(lmsAttempt({ origin: "import" }), { users, packages, gradedTest: true }).source,
    ).toBe("import");
  });

  it("signs an anonymised imported passage with its pseudonym, not a name", () => {
    const row = lmsAttempt({
      origin: "import",
      userId: null,
      lmsUserName: null,
      participantKey: "7f3a9c21deadbeef",
    });

    const observation = toObservation.lms(row, { users, packages, gradedTest: true });

    expect(observation.participant).toBe("Участник 7f3a9c");
  });

  it("calls an unfinished attempt incomplete, not failed", () => {
    const observation = toObservation.web(
      webAttempt({ finishedAt: null, resultJson: null }),
      { users, gradedTest: true },
    );

    expect(observation.outcome).toBe("incomplete");
    expect(observation.passed).toBeNull();
    expect(observation.percent).toBeNull();
  });

  it("leaves a measurement run without a percent and without a verdict", () => {
    const observation = toObservation.web(
      webAttempt({ resultJson: { overallPercent: 0, totalPossiblePoints: 0 } }),
      { users, gradedTest: false },
    );

    expect(observation.percent).toBeNull();
    expect(observation.passed).toBeNull();
    expect(observation.outcome).toBe("completed");
  });

  it("measures duration between start and finish, and reports null while it runs", () => {
    expect(toObservation.web(webAttempt(), { users, gradedTest: true }).durationMs)
      .toBe(20 * 60 * 1000);
    expect(
      toObservation.web(webAttempt({ finishedAt: null }), { users, gradedTest: true }).durationMs,
    ).toBeNull();
  });

  it("keeps the publication version and the delivered form of a web attempt", () => {
    const observation = toObservation.web(webAttempt(), { users, gradedTest: true });

    expect(observation.snapshotId).toBe("snap-1");
    expect(observation.formId).toBe("form-A");
  });

  it("resolves the test of a legacy telemetry row through its package", () => {
    const observation = toObservation.lms(
      lmsAttempt({ testId: null }),
      { users, packages, gradedTest: true },
    );

    expect(observation.testId).toBe(TEST_ID);
  });

  it("несёт баллы прохождения: набранные и достижимые", () => {
    const fromWeb = toObservation.web(
      webAttempt({
        resultJson: {
          overallPercent: 78, overallPassed: true,
          totalEarnedPoints: 15.5, totalPossiblePoints: 20,
        },
      }),
      { users, gradedTest: true },
    );
    const fromLms = toObservation.lms(
      lmsAttempt({ totalPoints: 15.5, maxPoints: 20 }),
      { users, packages, gradedTest: true },
    );

    expect(fromWeb.earnedPoints).toBe(15.5);
    expect(fromWeb.possiblePoints).toBe(20);
    expect(fromLms.earnedPoints).toBe(15.5);
    expect(fromLms.possiblePoints).toBe(20);
  });

  it("не выдумывает баллы там, где их не считали", () => {
    const observation = toObservation.web(
      webAttempt({ resultJson: { overallPercent: 0, totalPossiblePoints: 0 } }),
      { users, gradedTest: false },
    );

    expect(observation.earnedPoints).toBeNull();
    expect(observation.possiblePoints).toBeNull();
  });

  it("считает прохождение завершённым, если результат есть, даже без отметки времени", () => {
    // Аномалия данных: результат посчитан, а `finished_at` не проставлен. Такое
    // прохождение состоялось — терять его в «не завершено» значит занижать выборку.
    const observation = toObservation.web(
      webAttempt({ finishedAt: null }),
      { users, gradedTest: true },
    );

    expect(observation.outcome).toBe("passed");
    // Длительность при этом неизвестна: конца у прохождения не записано.
    expect(observation.durationMs).toBeNull();
  });

  it("оставляет незавершённой попытку без результата и без отметки времени", () => {
    const observation = toObservation.web(
      webAttempt({ finishedAt: null, resultJson: null }),
      { users, gradedTest: true },
    );

    expect(observation.outcome).toBe("incomplete");
  });
});
