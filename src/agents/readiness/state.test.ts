import { describe, it, expect } from "vitest";
import { ReadinessCode } from "./codes.js";
import { ReadinessRunState } from "./state.js";
import type { ResolvedReadinessPolicy, ReadinessEvaluation } from "./types.js";

const NOW = 2000000000000;

function makePolicy(disposition: ResolvedReadinessPolicy["disposition"]): ResolvedReadinessPolicy {
  return {
    disposition,
    source: { sourceId: "test", authorityLevel: 10 as unknown as number },
    environmentAttestation: "PRODUCTION",
    projectionBindingRequired: false,
    resolvedAt: NOW,
  };
}

function makeEvaluation(
  policy: ResolvedReadinessPolicy,
  decision: "READY" | "BLOCKED",
  outcome: "EVIDENCE_READY" | "BLOCKED" | "POLICY_BYPASS_NON_PRODUCTION" | "ROUTE_NOT_APPLICABLE",
): ReadinessEvaluation {
  return {
    decision,
    outcome,
    classification:
      decision === "READY" ? ReadinessCode.POLICY_REQUIRED : ReadinessCode.POLICY_UNRESOLVED,
    diagnosticRef: "test",
    evaluatedAt: NOW,
    policy,
  };
}

describe("ReadinessRunState", () => {
  it("mayExecute returns true for NOT_APPLICABLE", () => {
    const policy = makePolicy("NOT_APPLICABLE");
    const state = ReadinessRunState.create({ policy, evaluation: null, now: NOW });
    expect(state.mayExecute()).toBe(true);
    expect(state.isBlocked()).toBe(false);
  });

  it("mayExecute returns true for EXPLICITLY_DISABLED_NON_PRODUCTION", () => {
    const policy = makePolicy("EXPLICITLY_DISABLED_NON_PRODUCTION");
    const state = ReadinessRunState.create({ policy, evaluation: null, now: NOW });
    expect(state.mayExecute()).toBe(true);
    expect(state.isBlocked()).toBe(false);
  });

  it("mayExecute returns true for REQUIRED with READY evaluation", () => {
    const policy = makePolicy("REQUIRED");
    const evaluation = makeEvaluation(policy, "READY", "EVIDENCE_READY");
    const state = ReadinessRunState.create({ policy, evaluation, now: NOW });
    expect(state.mayExecute()).toBe(true);
    expect(state.isBlocked()).toBe(false);
  });

  it("mayExecute returns false for REQUIRED with BLOCKED evaluation", () => {
    const policy = makePolicy("REQUIRED");
    const evaluation = makeEvaluation(policy, "BLOCKED", "BLOCKED");
    const state = ReadinessRunState.create({ policy, evaluation, now: NOW });
    expect(state.mayExecute()).toBe(false);
    expect(state.isBlocked()).toBe(true);
  });

  it("mayExecute returns false for UNRESOLVED", () => {
    const policy = makePolicy("UNRESOLVED");
    const state = ReadinessRunState.create({ policy, evaluation: null, now: NOW });
    expect(state.mayExecute()).toBe(false);
    expect(state.isBlocked()).toBe(true);
  });

  it("mayExecute returns false when evaluation is null and policy is REQUIRED", () => {
    const policy = makePolicy("REQUIRED");
    const state = ReadinessRunState.create({ policy, evaluation: null, now: NOW });
    expect(state.mayExecute()).toBe(false);
    expect(state.isBlocked()).toBe(true);
  });

  it("toBlockedResult returns sanitized result", () => {
    const policy = makePolicy("REQUIRED");
    const evaluation = makeEvaluation(policy, "BLOCKED", "BLOCKED");
    const state = ReadinessRunState.create({ policy, evaluation, now: NOW });
    const blocked = state.toBlockedResult();
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.sanitizedMessage).toBeTruthy();
    expect(blocked.classification).toBeTruthy();
    expect(blocked.diagnosticRef).toBeTruthy();
  });

  it("stores policy and evaluation", () => {
    const policy = makePolicy("REQUIRED");
    const evaluation = makeEvaluation(policy, "READY", "EVIDENCE_READY");
    const state = ReadinessRunState.create({ policy, evaluation, now: NOW });
    expect(state.policy).toBe(policy);
    expect(state.evaluation).toBe(evaluation);
  });

  it("same input with same time produces identical state", () => {
    const policy = makePolicy("REQUIRED");
    const evaluation = makeEvaluation(policy, "READY", "EVIDENCE_READY");
    const a = ReadinessRunState.create({ policy, evaluation, now: NOW });
    const b = ReadinessRunState.create({ policy, evaluation, now: NOW });
    expect(a.evaluatedAt).toBe(b.evaluatedAt);
  });

  it("different supplied time changes evaluatedAt", () => {
    const policy = makePolicy("REQUIRED");
    const a = ReadinessRunState.create({ policy, evaluation: null, now: 1000 });
    const b = ReadinessRunState.create({ policy, evaluation: null, now: 2000 });
    expect(a.evaluatedAt).toBe(1000);
    expect(b.evaluatedAt).toBe(2000);
  });

  it("evaluation present uses evaluation.evaluatedAt", () => {
    const policy = makePolicy("REQUIRED");
    const evaluation = makeEvaluation(policy, "READY", "EVIDENCE_READY");
    const state = ReadinessRunState.create({ policy, evaluation, now: 9999 });
    expect(state.evaluatedAt).toBe(NOW);
  });

  it("rejects REQUIRED with POLICY_BYPASS_NON_PRODUCTION", () => {
    const policy = makePolicy("REQUIRED");
    const evaluation = makeEvaluation(policy, "READY", "POLICY_BYPASS_NON_PRODUCTION");
    expect(() => ReadinessRunState.create({ policy, evaluation, now: NOW })).toThrow();
  });

  it("rejects REQUIRED with ROUTE_NOT_APPLICABLE", () => {
    const policy = makePolicy("REQUIRED");
    const evaluation = makeEvaluation(policy, "READY", "ROUTE_NOT_APPLICABLE");
    expect(() => ReadinessRunState.create({ policy, evaluation, now: NOW })).toThrow();
  });

  it("rejects NOT_APPLICABLE with EVIDENCE_READY", () => {
    const policy = makePolicy("NOT_APPLICABLE");
    const evaluation = makeEvaluation(policy, "READY", "EVIDENCE_READY");
    expect(() => ReadinessRunState.create({ policy, evaluation, now: NOW })).toThrow();
  });

  it("rejects UNRESOLVED with EVIDENCE_READY", () => {
    const policy = makePolicy("UNRESOLVED");
    const evaluation = makeEvaluation(policy, "READY", "EVIDENCE_READY");
    expect(() => ReadinessRunState.create({ policy, evaluation, now: NOW })).toThrow();
  });

  it("rejects EXPLICITLY_DISABLED_NON_PRODUCTION with EVIDENCE_READY", () => {
    const policy = makePolicy("EXPLICITLY_DISABLED_NON_PRODUCTION");
    const evaluation = makeEvaluation(policy, "READY", "EVIDENCE_READY");
    expect(() => ReadinessRunState.create({ policy, evaluation, now: NOW })).toThrow();
  });

  it("accepts EXPLICITLY_DISABLED_NON_PRODUCTION with POLICY_BYPASS_NON_PRODUCTION", () => {
    const policy = makePolicy("EXPLICITLY_DISABLED_NON_PRODUCTION");
    const evaluation = makeEvaluation(policy, "READY", "POLICY_BYPASS_NON_PRODUCTION");
    const state = ReadinessRunState.create({ policy, evaluation, now: NOW });
    expect(state.mayExecute()).toBe(true);
  });

  it("accepts NOT_APPLICABLE with ROUTE_NOT_APPLICABLE", () => {
    const policy = makePolicy("NOT_APPLICABLE");
    const evaluation = makeEvaluation(policy, "READY", "ROUTE_NOT_APPLICABLE");
    const state = ReadinessRunState.create({ policy, evaluation, now: NOW });
    expect(state.mayExecute()).toBe(true);
  });

  it("accepts UNRESOLVED with BLOCKED", () => {
    const policy = makePolicy("UNRESOLVED");
    const evaluation = makeEvaluation(policy, "BLOCKED", "BLOCKED");
    const state = ReadinessRunState.create({ policy, evaluation, now: NOW });
    expect(state.mayExecute()).toBe(false);
  });
});
