import { describe, it, expect } from "vitest";
import { ReadinessCode } from "./codes.js";
import { evaluateReadiness } from "./evaluator.js";
import type { ResolvedReadinessPolicy } from "./types.js";

const NOW = 2000000000000;
const FUTURE = new Date(NOW + 86400000).toISOString();

function makePolicy(
  overrides: Partial<ResolvedReadinessPolicy> & {
    disposition: ResolvedReadinessPolicy["disposition"];
  },
): ResolvedReadinessPolicy {
  return {
    source: { sourceId: "test", authorityLevel: 10 as unknown as number },
    environmentAttestation: "PRODUCTION",
    projectionBindingRequired: false,
    resolvedAt: NOW,
    ...overrides,
  };
}

describe("evaluateReadiness", () => {
  it("REQUIRED with valid READY evidence returns EVIDENCE_READY", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const evidence = JSON.stringify({
      contract_version: "readiness.v1",
      decision: "READY",
      valid_until: FUTURE,
    });
    const result = evaluateReadiness(policy, evidence, null, null, NOW);
    expect(result.outcome).toBe("EVIDENCE_READY");
    expect(result.decision).toBe("READY");
  });

  it("REQUIRED with missing evidence returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const result = evaluateReadiness(policy, null, null, null, NOW);
    expect(result.outcome).toBe("BLOCKED");
    expect(result.classification).toBe(ReadinessCode.EVIDENCE_MISSING);
  });

  it("REQUIRED with malformed evidence returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const result = evaluateReadiness(policy, "{invalid}", null, null, NOW);
    expect(result.outcome).toBe("BLOCKED");
  });

  it("REQUIRED with expired evidence returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const past = new Date(NOW - 86400000).toISOString();
    const evidence = JSON.stringify({
      contract_version: "readiness.v1",
      decision: "READY",
      valid_until: past,
    });
    const result = evaluateReadiness(policy, evidence, null, null, NOW);
    expect(result.outcome).toBe("BLOCKED");
    expect(result.classification).toBe(ReadinessCode.READINESS_EXPIRED);
  });

  it("REQUIRED with binding mismatch returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED", projectionBindingRequired: true });
    const evidence = JSON.stringify({
      contract_version: "readiness.v1",
      decision: "READY",
      valid_until: FUTURE,
      projection_id: "wrong",
    });
    const result = evaluateReadiness(policy, evidence, "expected", null, NOW);
    expect(result.outcome).toBe("BLOCKED");
    expect(result.classification).toBe(ReadinessCode.PROJECTION_BINDING_MISMATCH);
  });

  it("UNRESOLVED blocks possible execution", () => {
    const policy = makePolicy({ disposition: "UNRESOLVED" });
    const result = evaluateReadiness(policy, null, null, null, NOW);
    expect(result.outcome).toBe("BLOCKED");
  });

  it("disabled non-production returns POLICY_BYPASS_NON_PRODUCTION", () => {
    const policy = makePolicy({ disposition: "EXPLICITLY_DISABLED_NON_PRODUCTION" });
    const result = evaluateReadiness(policy, null, null, null, NOW);
    expect(result.outcome).toBe("POLICY_BYPASS_NON_PRODUCTION");
    expect(result.decision).toBe("READY");
  });

  it("NOT_APPLICABLE returns ROUTE_NOT_APPLICABLE", () => {
    const policy = makePolicy({ disposition: "NOT_APPLICABLE" });
    const result = evaluateReadiness(policy, null, null, null, NOW);
    expect(result.outcome).toBe("ROUTE_NOT_APPLICABLE");
    expect(result.decision).toBe("READY");
  });

  it("REQUIRED with BLOCKED contract returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const evidence = JSON.stringify({ contract_version: "readiness.v1", decision: "BLOCKED" });
    const result = evaluateReadiness(policy, evidence, null, null, NOW);
    expect(result.outcome).toBe("BLOCKED");
  });

  it("REQUIRED with duplicate key evidence returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const evidence =
      '{"contract_version":"readiness.v1","decision":"READY","valid_until":"' +
      FUTURE +
      '","valid_until":"' +
      FUTURE +
      '"}';
    const result = evaluateReadiness(policy, evidence, null, null, NOW);
    expect(result.outcome).toBe("BLOCKED");
    expect(result.classification).toBe(ReadinessCode.DUPLICATE_KEY);
  });

  it("bypass and evidence-ready have distinct outcomes", () => {
    const policy = makePolicy({ disposition: "EXPLICITLY_DISABLED_NON_PRODUCTION" });
    const bypass = evaluateReadiness(policy, null, null, null, NOW);
    const reqPolicy = makePolicy({ disposition: "REQUIRED" });
    const evidence = JSON.stringify({
      contract_version: "readiness.v1",
      decision: "READY",
      valid_until: FUTURE,
    });
    const evidenceReady = evaluateReadiness(reqPolicy, evidence, null, null, NOW);
    expect(bypass.outcome).not.toBe(evidenceReady.outcome);
    expect(bypass.outcome).toBe("POLICY_BYPASS_NON_PRODUCTION");
    expect(evidenceReady.outcome).toBe("EVIDENCE_READY");
  });
});
