/**
 * @module shared/breakdown/publish-warnings
 * @description PRD-50 FR-45 - FR-47: the delivery traps an author is told about when a
 * test is published. WARNINGS, never blocks — publication proceeds and the snapshot is
 * frozen; the author decides what to do. Pure: the caller gathers the data, this only
 * judges it, so the same rules can later feed the editor without a second implementation.
 *
 * The traps come straight from the reference workbook: two questions of «Технологии» belong
 * to no variant and can never be delivered, and nothing in the service ever said so.
 *
 * FR-46 («порог назначен ключу, которого выдача не даст») is GONE: a key threshold no
 * longer gates anything (решение владельца 2026-09-03), so an unreachable threshold has
 * nothing to make unreachable. Stored thresholds stay in the data as legacy.
 */
import { tagKey } from "../tags";
import { resolveBreakdownRules } from "../scoring/pass-rule";

export type BreakdownWarningCode =
  /** FR-45: Σ quotas ≠ the section's sample size — the keys do not partition it. */
  | "quota_sum_mismatch"
  /** FR-45: deliverable questions carry no key at all. */
  | "questions_without_key"
  /** FR-47: a question belongs to no variant and will never be delivered. */
  | "question_outside_variants"
  /** FR-47: quotas AND variants are both set; in variants mode quotas are not applied. */
  | "quotas_ignored_in_variants"
  /**
   * The section still stores key thresholds, which no longer gate anything (решение
   * владельца 2026-09-03). Said ONCE, at publication: the topic verdict of this test may
   * come out different from the one the previous publication produced.
   */
  | "key_thresholds_no_longer_gate";

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

/** One section as the check sees it: delivery config, thresholds and the topic's pool. */
export interface BreakdownPublishSection {
  topicId: string;
  topicName: string;
  drawCount: number;
  drawAll: boolean;
  blueprint: { strata: Array<{ tag: string; count: number }> } | null;
  /** PRD-17 variants, or null when the section is not in variants mode. */
  variants: Array<{ id: string; label: string; questionIds: string[] }> | null;
  /** Stored `test_sections.breakdown_rules_json` (any shape — normalised here). */
  rules: unknown;
  questions: Array<{ id: string; tags: string[] }>;
}

/** Distinct normalised keys of one question. */
function keysOf(q: { tags: string[] }): Set<string> {
  const out = new Set<string>();
  for (const t of q.tags ?? []) {
    const k = tagKey(t);
    if (k) out.add(k);
  }
  return out;
}

export function checkBreakdownPublish(sections: readonly BreakdownPublishSection[]): BreakdownWarning[] {
  const out: BreakdownWarning[] = [];
  for (const s of sections) {
    const at = (w: Omit<BreakdownWarning, "topicId" | "topicName">) =>
      out.push({ topicId: s.topicId, topicName: s.topicName, ...w });
    const rules = resolveBreakdownRules(s.rules);
    const variants = s.variants && s.variants.length > 0 ? s.variants : null;

    // FR-47: quotas are silently inert in variants mode (PRD-17 FR-03). Saying so is the
    // whole point — the author configured two things and only one of them runs.
    if (variants && s.blueprint && !s.drawAll) at({ code: "quotas_ignored_in_variants" });

    // FR-47: a question outside every variant will never be delivered — the exact case the
    // reference workbook hides two questions in.
    if (variants) {
      const used = new Set(variants.flatMap((f) => f.questionIds));
      const orphans = s.questions.filter((q) => !used.has(q.id)).length;
      if (orphans > 0) at({ code: "question_outside_variants", count: orphans });
    }

    // The delivery pool the remaining checks judge: in variants mode only what a variant can
    // hand out, otherwise the topic's whole bank.
    const deliverable = variants
      ? s.questions.filter((q) => variants.some((f) => f.questionIds.includes(q.id)))
      : s.questions;
    const declaresKeys = s.blueprint != null || rules != null;

    // FR-45, first half: quotas that do not add up to the sample are not a partition of it.
    if (!variants && !s.drawAll && s.blueprint) {
      const sum = s.blueprint.strata.reduce((acc, st) => acc + (st.count || 0), 0);
      if (sum !== s.drawCount) at({ code: "quota_sum_mismatch", count: sum, total: s.drawCount });
    }

    // FR-45, second half: a deliverable question with no key falls outside every bar, and the
    // bars therefore do not add up to the section. Only worth saying when keys are in play.
    if (declaresKeys) {
      const withoutKey = deliverable.filter((q) => keysOf(q).size === 0).length;
      if (withoutKey > 0) at({ code: "questions_without_key", count: withoutKey });
    }

    // Тест, который раньше судился порогами подтем, теперь судится одним правилом темы.
    // Автор должен узнать об этом ДО того, как увидит другой вердикт у той же попытки.
    if (rules) at({ code: "key_thresholds_no_longer_gate" });
  }
  return out;
}
