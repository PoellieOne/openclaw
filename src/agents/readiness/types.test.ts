import { describe, it, expect } from "vitest";
import {
  READINESS_AUTHORITY_AGENT_CONFIG,
  READINESS_AUTHORITY_AGENT_DEFAULTS,
  READINESS_AUTHORITY_HIGHEST,
  READINESS_AUTHORITY_LOWEST,
  READINESS_AUTHORITY_ROUTE_CLASSIFICATION,
  READINESS_AUTHORITY_TEST_HARNESS,
} from "./types.js";
import type { ReadinessGovernance, ReadinessRouteClassification } from "./types.js";

describe("Readiness types", () => {
  it("authority levels are ordered correctly", () => {
    expect(READINESS_AUTHORITY_HIGHEST).toBeLessThan(READINESS_AUTHORITY_AGENT_CONFIG);
    expect(READINESS_AUTHORITY_AGENT_CONFIG).toBeLessThan(READINESS_AUTHORITY_AGENT_DEFAULTS);
    expect(READINESS_AUTHORITY_AGENT_DEFAULTS).toBeLessThan(
      READINESS_AUTHORITY_ROUTE_CLASSIFICATION,
    );
    expect(READINESS_AUTHORITY_ROUTE_CLASSIFICATION).toBeLessThan(READINESS_AUTHORITY_TEST_HARNESS);
    expect(READINESS_AUTHORITY_TEST_HARNESS).toBeLessThan(READINESS_AUTHORITY_LOWEST);
  });

  it("ReadinessGovernance governed variant carries state", () => {
    const g: ReadinessGovernance = {
      governed: true,
      state: { mayExecute: () => true, isBlocked: () => false } as never,
    };
    expect(g.governed).toBe(true);
  });

  it("ReadinessGovernance ungoverned variant carries reason", () => {
    const g: ReadinessGovernance = {
      governed: false,
      reason: "EXPLICIT_LEGACY_ROLLOUT_EXCEPTION",
    };
    expect(g.governed).toBe(false);
  });

  it("ReadinessRouteClassification includes all expected values", () => {
    const values: ReadinessRouteClassification[] = [
      "REAL_MODEL_EXECUTION_ROUTE",
      "TEST_MODEL_EXECUTION_ROUTE",
      "TRUSTED_NON_MODEL_ROUTE",
      "UNKNOWN_OR_MISSING_ROUTE",
    ];
    expect(values).toHaveLength(4);
  });
});
