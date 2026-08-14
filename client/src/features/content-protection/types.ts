/**
 * @module features/content-protection/types
 *
 * Client mirror of the PRD-15 block A protection payloads (server services
 * draw-feasibility / content-guard). A destructive or grading-affecting
 * operation on shared content returns these shapes; the client renders them in
 * the content-impact dialog (T-12).
 */

/** One reason a dependent test is affected (server `FeasibilityIssue`). */
export type FeasibilityIssue =
  | { kind: "pool_shortfall"; required: number; available: number }
  | { kind: "quota_shortfall"; tag: string; requested: number; available: number }
  | {
      kind: "adaptive_shortfall";
      levelIndex: number;
      levelName?: string;
      required: number;
      available: number;
    }
  | { kind: "measurement_loss"; questionIds: string[] }
  | { kind: "variant_incomplete"; questionIds: string[] }
  | { kind: "content_pages_loss"; pageCount: number }
  | { kind: "formula_loss"; variableNames: string[] }
  | { kind: "draw_all_shrink"; removed: number; remaining: number; advisory: true };

/** A dependent test with its issues (server `TestFeasibility`). */
export interface TestFeasibility {
  testId: string;
  title?: string;
  status?: string;
  ownerId?: string | null;
  issues: FeasibilityIssue[];
}

/** 409 `content_in_use` body. */
export interface ContentInUseError {
  error: "content_in_use";
  message: string;
  blocking: TestFeasibility[];
  warnings: TestFeasibility[];
}

/** `?dryRun=true` body (200). */
export interface DryRunResult {
  dryRun: true;
  wouldBlock: boolean;
  blocking: TestFeasibility[];
  warnings: TestFeasibility[];
}

/** One topic's findings at publish time (server `PublishCheckFinding`). */
export interface PublishCheckFinding {
  topicId: string;
  topicName: string;
  issues: FeasibilityIssue[];
}

/** 409 `publish_infeasible` body. */
export interface PublishInfeasibleError {
  error: "publish_infeasible";
  message: string;
  findings: PublishCheckFinding[];
}

/**
 * PRD-50 FR-45 - FR-47: one delivery trap reported AFTER a successful publication
 * (server `BreakdownWarningCode`). A warning, never a block — the mirror image of
 * {@link PublishInfeasibleError}, which is a 409.
 */
export type BreakdownWarningCode =
  | "quota_sum_mismatch"
  | "questions_without_key"
  | "threshold_key_never_delivered"
  | "question_outside_variants"
  | "quotas_ignored_in_variants";

/** One publication warning (server `BreakdownWarning`). */
export interface BreakdownWarning {
  code: BreakdownWarningCode;
  topicId: string;
  topicName: string;
  /** The key the warning speaks about (`threshold_key_never_delivered`). */
  key?: string;
  /** The number the message quotes: Σ quotas, or how many questions are affected. */
  count?: number;
  /** What `count` is compared against (the section's sample size). */
  total?: number;
}
