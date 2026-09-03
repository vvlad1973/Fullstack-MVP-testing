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

/**
 * One key threshold. `none` says the key is INFORMATIONAL on purpose — it is not the same
 * as an absent entry, which falls back to {@link BreakdownRules.default} (FR-20).
 */
export type BreakdownThreshold = { type: "percent"; value: number } | { type: "none" };

/**
 * PRD-50 §4 (FR-09/FR-10): the grading rules of one section's breakdown axis, stored in
 * `test_sections.breakdown_rules_json`. Kept apart from `draw_blueprint_json` on purpose
 * (решение 5): a quota is about DELIVERY, a threshold about GRADING, and either is
 * meaningful without the other. Absent structure = every key is informational.
 */
export interface BreakdownRules {
  /** Axis the rules speak about. Only `"tag"` is registered in this edition (FR-06). */
  axis: string;
  /** Threshold for every key without an own entry (FR-20). Absent = no fallback gate. */
  default?: BreakdownThreshold;
  /** Per-key thresholds; a key absent here falls back to {@link BreakdownRules.default}. */
  keys?: Record<string, BreakdownThreshold>;
}

/**
 * PRD-50 FR-50: обратная связь подтем ОДНОГО раздела, хранится в
 * `test_sections.breakdown_feedback_json`. Значение записи — то же содержимое, что у
 * обратной связи темы (`format`, `text`, `links`, `assets`, `events`), поэтому текст
 * подтемы проходит через тот же сборщик рекомендаций, что и остальные источники.
 *
 * Тип содержимого здесь параметризован (`unknown` на уровне ядра разреза): `shared/schema`
 * валидирует его схемой `feedbackContentSchema`, а рендер-контекст принимает уже разобранное
 * значение. Так модуль разреза не начинает зависеть от схемы БД.
 */
export interface BreakdownFeedback<T = unknown> {
  /** Axis the texts speak about. Only `"tag"` is registered in this edition. */
  axis: string;
  /** Ключ подтемы -> её текст с рекомендациями. */
  keys: Record<string, T>;
}
