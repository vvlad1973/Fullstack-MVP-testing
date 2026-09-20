/**
 * @module tests/shared.flow-policy
 *
 * One normalisation of `flow_policy_json` for both hosts. The cases below are the
 * ones the hosts used to answer differently — an unknown mode, router gating outside
 * router mode, an absent completion policy — so a change here is a change to what
 * BOTH the package and the web run do.
 */
import { describe, it, expect } from "vitest";
import { resolveFlowPolicy } from "../shared/flow/flow-policy";

describe("flow-policy — mode", () => {
  it("falls back to linear_flat on absence, null and an unknown mode", () => {
    // FR-40: a row this build cannot read still delivers its questions.
    expect(resolveFlowPolicy(undefined).mode).toBe("linear_flat");
    expect(resolveFlowPolicy(null).mode).toBe("linear_flat");
    expect(resolveFlowPolicy({}).mode).toBe("linear_flat");
    expect(resolveFlowPolicy({ mode: "from_the_future" }).mode).toBe("linear_flat");
  });

  it("keeps the two sectional modes as authored", () => {
    expect(resolveFlowPolicy({ mode: "linear_by_topics" }).mode).toBe("linear_by_topics");
    expect(resolveFlowPolicy({ mode: "router_by_topics" }).mode).toBe("router_by_topics");
  });
});

describe("flow-policy — router gating", () => {
  it("defaults the completion policy to the softer rule in router mode", () => {
    expect(resolveFlowPolicy({ mode: "router_by_topics" })).toEqual({
      mode: "router_by_topics",
      routerCompletionPolicy: "all_required_completed",
    });
  });

  it("keeps the strict rule when authored", () => {
    expect(
      resolveFlowPolicy({ mode: "router_by_topics", routerCompletionPolicy: "all_required_passed" })
        .routerCompletionPolicy,
    ).toBe("all_required_passed");
  });

  it("carries the unlock rules when authored", () => {
    const rules = { t2: { mode: "after_sections_completed", sectionIds: ["t1"] } };
    expect(resolveFlowPolicy({ mode: "router_by_topics", sectionUnlockRules: rules })
      .sectionUnlockRules).toEqual(rules);
  });

  // The package ships this object verbatim as TEST_DATA.flowPolicy, so a key that
  // appears where it has no meaning rewrites the bytes of every non-router package.
  it("omits the router fields entirely outside router mode", () => {
    const resolved = resolveFlowPolicy({
      mode: "linear_by_topics",
      routerCompletionPolicy: "all_required_passed",
      sectionUnlockRules: { t2: { mode: "after_sections_completed", sectionIds: ["t1"] } },
    });
    expect(resolved).toEqual({ mode: "linear_by_topics" });
    expect("routerCompletionPolicy" in resolved).toBe(false);
    expect("sectionUnlockRules" in resolved).toBe(false);
  });

  it("omits sectionUnlockRules when the author set none", () => {
    expect("sectionUnlockRules" in resolveFlowPolicy({ mode: "router_by_topics" })).toBe(false);
  });
});
