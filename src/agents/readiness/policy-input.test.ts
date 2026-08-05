import { describe, it, expect } from "vitest";
import { resolveReadinessPolicyInput } from "./policy-input.js";
import {
  READINESS_AUTHORITY_HIGHEST,
  READINESS_AUTHORITY_TEST_HARNESS,
  READINESS_AUTHORITY_ROUTE_CLASSIFICATION,
} from "./types.js";

const NOW = 2000000000000;

describe("resolveReadinessPolicyInput", () => {
  it("real model route returns REQUIRED + PRODUCTION", () => {
    const result = resolveReadinessPolicyInput({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      now: NOW,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.mode).toBe("required");
    expect(result.candidates[0]!.authorityLevel).toBe(READINESS_AUTHORITY_HIGHEST);
    expect(result.environmentAttestation).toBe("PRODUCTION");
  });

  it("test model route returns REQUIRED + TEST_HARNESS", () => {
    const result = resolveReadinessPolicyInput({
      routeClassification: "TEST_MODEL_EXECUTION_ROUTE",
      now: NOW,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.mode).toBe("required");
    expect(result.candidates[0]!.authorityLevel).toBe(READINESS_AUTHORITY_TEST_HARNESS);
    expect(result.environmentAttestation).toBe("TEST_HARNESS");
  });

  it("isTestHarness flag overrides to TEST_HARNESS", () => {
    const result = resolveReadinessPolicyInput({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      isTestHarness: true,
      now: NOW,
    });
    expect(result.environmentAttestation).toBe("TEST_HARNESS");
    expect(result.candidates[0]!.authorityLevel).toBe(READINESS_AUTHORITY_TEST_HARNESS);
  });

  it("trusted non-model route returns NOT_APPLICABLE semantics", () => {
    const result = resolveReadinessPolicyInput({
      routeClassification: "TRUSTED_NON_MODEL_ROUTE",
      now: NOW,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.applicability).toBe("non-model");
    expect(result.candidates[0]!.authorityLevel).toBe(READINESS_AUTHORITY_ROUTE_CLASSIFICATION);
  });

  it("unknown route returns empty candidates (UNRESOLVED)", () => {
    const result = resolveReadinessPolicyInput({
      routeClassification: "UNKNOWN_OR_MISSING_ROUTE",
      now: NOW,
    });
    expect(result.candidates).toHaveLength(0);
  });

  it("explicit now propagated deterministically", () => {
    const a = resolveReadinessPolicyInput({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      now: 1000,
    });
    const b = resolveReadinessPolicyInput({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      now: 1000,
    });
    expect(a.now).toBe(1000);
    expect(b.now).toBe(1000);
  });

  it("same input + same now produces identical output", () => {
    const a = resolveReadinessPolicyInput({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      now: NOW,
    });
    const b = resolveReadinessPolicyInput({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      now: NOW,
    });
    expect(a).toEqual(b);
  });

  it("non-production disable is not supported", () => {
    const result = resolveReadinessPolicyInput({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      now: NOW,
    });
    expect(result.candidates[0]!.disablePermittedByGoverningPolicy).toBe(false);
  });

  it("ordinary low-authority input cannot weaken REQUIRED", () => {
    const result = resolveReadinessPolicyInput({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      now: NOW,
    });
    expect(result.candidates[0]!.mode).toBe("required");
    expect(result.candidates[0]!.authorityLevel).toBe(READINESS_AUTHORITY_HIGHEST);
  });
});
