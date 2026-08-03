import type {
  ReadinessPolicyResolutionInput,
  ReadinessRouteClassification,
  EnvironmentAttestation,
} from "./types.js";
import {
  READINESS_AUTHORITY_HIGHEST,
  READINESS_AUTHORITY_TEST_HARNESS,
  READINESS_AUTHORITY_ROUTE_CLASSIFICATION,
} from "./types.js";

export function resolveReadinessPolicyInput(params: {
  routeClassification: ReadinessRouteClassification;
  environmentAttestation?: EnvironmentAttestation;
  isTestHarness?: boolean;
  now: number;
}): ReadinessPolicyResolutionInput {
  const env = params.environmentAttestation ?? "PRODUCTION";
  const now = params.now;

  if (params.isTestHarness || params.routeClassification === "TEST_MODEL_EXECUTION_ROUTE") {
    return {
      candidates: [
        {
          sourceId: "test-harness",
          authorityLevel: READINESS_AUTHORITY_TEST_HARNESS,
          mode: "required",
          applicability: "governed",
          disablePermittedByGoverningPolicy: false,
          projectionBindingRequired: true,
        },
      ],
      environmentAttestation: "TEST_HARNESS",
      now,
    };
  }

  if (params.routeClassification === "REAL_MODEL_EXECUTION_ROUTE") {
    return {
      candidates: [
        {
          sourceId: "runtime-default",
          authorityLevel: READINESS_AUTHORITY_HIGHEST,
          mode: "required",
          applicability: "governed",
          disablePermittedByGoverningPolicy: false,
          projectionBindingRequired: true,
        },
      ],
      environmentAttestation: env,
      now,
    };
  }

  if (params.routeClassification === "TRUSTED_NON_MODEL_ROUTE") {
    return {
      candidates: [
        {
          sourceId: "route-classification",
          authorityLevel: READINESS_AUTHORITY_ROUTE_CLASSIFICATION,
          mode: "inherit",
          applicability: "non-model",
          disablePermittedByGoverningPolicy: false,
          projectionBindingRequired: false,
        },
      ],
      environmentAttestation: env,
      now,
    };
  }

  return {
    candidates: [],
    environmentAttestation: env,
    now,
  };
}
