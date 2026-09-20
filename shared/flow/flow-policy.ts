/**
 * @module shared/flow/flow-policy
 *
 * `tests.flow_policy_json` as a RUNTIME reads it — one normalisation for both
 * learner hosts.
 *
 * The column is authored JSON: it may hold a mode this build does not know, may
 * miss the router fields entirely, and carries the router's gating
 * (`routerCompletionPolicy`, `sectionUnlockRules`) next to modes that have no
 * router at all. Turning that into the shape a runtime can act on is a decision —
 * which mode to fall back to, what an absent completion policy means, whether the
 * router fields travel outside router mode — and while each host made that decision
 * for itself they disagreed: the SCORM bake clamped the mode and shipped the gating,
 * the web attempt payload passed the raw mode through and shipped NOTHING, so a
 * section locked by a prerequisite in the LMS was open on the web, and «Завершить»
 * under `all_required_passed` unlocked on the web as soon as the sections were
 * merely finished.
 *
 * Framework-free and browser-safe, like the rest of `shared/flow`.
 */

import type { SectionUnlockRule } from "./router-hub";

/** The traversal strategies a runtime implements. */
export type ResolvedFlowMode = "linear_flat" | "linear_by_topics" | "router_by_topics";

/** When «Завершить» may be offered on the router hub. */
export type RouterCompletionPolicy = "all_required_completed" | "all_required_passed";

/**
 * The policy a runtime acts on. The router fields are ABSENT outside router mode —
 * not `null`, absent: the SCORM package ships this object as `TEST_DATA.flowPolicy`,
 * and a key that appears where it has no meaning would change the bytes of every
 * non-router package.
 */
export interface ResolvedFlowPolicy {
  mode: ResolvedFlowMode;
  routerCompletionPolicy?: RouterCompletionPolicy;
  sectionUnlockRules?: Record<string, SectionUnlockRule>;
}

/** The authored shape, as far as this module cares about it. */
interface RawFlowPolicy {
  mode?: unknown;
  routerCompletionPolicy?: unknown;
  sectionUnlockRules?: unknown;
}

/**
 * Normalises an authored `flow_policy_json` (or its absence) into
 * {@link ResolvedFlowPolicy}.
 *
 * An unknown or missing mode falls back to `linear_flat` (PRD-4 v1.1 FR-40): that is
 * the traversal every test had before the modes existed, so a row this build cannot
 * read still delivers its questions instead of stranding the learner.
 *
 * The router fields are resolved ONLY in router mode — elsewhere they describe a
 * screen the run never reaches. `routerCompletionPolicy` defaults to the SOFTER
 * `all_required_completed`: the strict rule can leave a learner on a hub they cannot
 * leave (a failed required section with no retake), and that is not a state to fall
 * into by accident. `sectionUnlockRules` is carried only when authored — an empty map
 * and a missing one mean the same thing to {@link isSectionUnlocked}, and omitting it
 * keeps the package of a test without rules byte-identical.
 */
export function resolveFlowPolicy(raw: unknown): ResolvedFlowPolicy {
  const src = (raw ?? {}) as RawFlowPolicy;
  const mode: ResolvedFlowMode =
    src.mode === "linear_by_topics" || src.mode === "router_by_topics" ? src.mode : "linear_flat";
  if (mode !== "router_by_topics") return { mode };

  const resolved: ResolvedFlowPolicy = {
    mode,
    routerCompletionPolicy:
      src.routerCompletionPolicy === "all_required_passed"
        ? "all_required_passed"
        : "all_required_completed",
  };
  if (src.sectionUnlockRules && typeof src.sectionUnlockRules === "object") {
    resolved.sectionUnlockRules = src.sectionUnlockRules as Record<string, SectionUnlockRule>;
  }
  return resolved;
}
