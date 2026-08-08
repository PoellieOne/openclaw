import { describe, it, expect } from "vitest";
import { CONTRACT_VERSION_V2 } from "./contracts-v2.js";
import { resolveReadinessPolicyInput } from "./policy-input.js";
import { resolveReadinessPolicy } from "./policy-resolver.js";
import {
  READINESS_AUTHORITY_HIGHEST,
  READINESS_AUTHORITY_TEST_HARNESS,
  READINESS_AUTHORITY_ROUTE_CLASSIFICATION,
} from "./types.js";

const NOW = 2000000000000;

describe("readiness policy V2 selection", () => {
  it("REAL_MODEL_EXECUTION_ROUTE requires the successor contract", () => {
    const input = resolveReadinessPolicyInput({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      now: NOW,
    });
    expect(input.candidates[0]!.contractVersion).toBe(CONTRACT_VERSION_V2);
    const policy = resolveReadinessPolicy(input);
    expect(policy.disposition).toBe("REQUIRED");
    expect(policy.contractVersion).toBe(CONTRACT_VERSION_V2);
  });

  it("V1 cannot READY on the production route (unsupported contract version)", () => {
    const input = resolveReadinessPolicyInput({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      now: NOW,
    });
    const policy = resolveReadinessPolicy(input);
    expect(policy.disposition).toBe("REQUIRED");
    expect(policy.contractVersion).toBe(CONTRACT_VERSION_V2);
    expect(policy.contractVersion).not.toBe("readiness.v1");
  });

  it("test harness route keeps its own candidate without successor requirement", () => {
    const input = resolveReadinessPolicyInput({
      routeClassification: "TEST_MODEL_EXECUTION_ROUTE",
      isTestHarness: true,
      now: NOW,
    });
    expect(input.candidates[0]!.authorityLevel).toBe(READINESS_AUTHORITY_TEST_HARNESS);
    expect(input.candidates[0]!.contractVersion).toBeUndefined();
  });

  it("trusted non-model route remains NOT_APPLICABLE", () => {
    const input = resolveReadinessPolicyInput({
      routeClassification: "TRUSTED_NON_MODEL_ROUTE",
      now: NOW,
    });
    expect(input.candidates[0]!.applicability).toBe("non-model");
    expect(input.candidates[0]!.authorityLevel).toBe(READINESS_AUTHORITY_ROUTE_CLASSIFICATION);
    const policy = resolveReadinessPolicy(input);
    expect(policy.disposition).toBe("NOT_APPLICABLE");
  });

  it("production readiness cannot be explicitly disabled through an unauthorized lower-authority policy", () => {
    const input = resolveReadinessPolicyInput({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      now: NOW,
    });
    expect(input.candidates[0]!.disablePermittedByGoverningPolicy).toBe(false);
    expect(input.candidates[0]!.authorityLevel).toBe(READINESS_AUTHORITY_HIGHEST);
  });

  it("existing Phase-B3 policy conflict protections remain intact", () => {
    const input = resolveReadinessPolicyInput({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      now: NOW,
    });
    const policy = resolveReadinessPolicy(input);
    expect(policy.disposition).toBe("REQUIRED");
    expect(policy.projectionBindingRequired).toBe(true);
  });
});
