/**
 * @module shared/breakdown/types
 * @description Input and output shapes of the PRD-50 result breakdown — the aggregate of
 * DELIVERED items grouped by an axis key within a scope. Kept apart from the compute so
 * both hosts and the render context can depend on the shapes without pulling the algorithm.
 */

/** One delivered, already-graded question as the breakdown sees it. */
export interface BreakdownItem {
  /** Section the question was DELIVERED in (PRD-50 решение 2) — not the owning topic. */
  sectionId: string;
  /** Keys per axis, e.g. `{ tag: ["Персональные данные"] }`. Absent = the item groups nowhere. */
  axisKeys?: Record<string, string[]> | null;
  /** Points earned for this question. */
  earned: number;
  /** Points the question could bring. Zero = measurement-only, excluded (FR-02). */
  possible: number;
  /** Whether the learner answered it at all. */
  answered: boolean;
}

/** One computed breakdown record. */
export interface BreakdownEntry {
  /** `"test"` or `"section:<sectionId>"`. */
  scope: string;
  axis: string;
  key: string;
  items: number;
  answered: number;
  earned: number;
  possible: number;
  /** Σ of per-question ratios — every question weighs 1 (FR-02). */
  unitEarned: number;
  /** = items. */
  unitPossible: number;
  /** `earned / possible`, 0…100. The verdict currency (FR-21). */
  percentPoints: number;
  /** `unitEarned / unitPossible`, 0…100. The display default (решение 4). */
  percentUnits: number;
}
