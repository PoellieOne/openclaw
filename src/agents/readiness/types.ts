import type { ReadinessCode } from "./codes.js";

export type ReadinessDisposition =
  | "REQUIRED"
  | "EXPLICITLY_DISABLED_NON_PRODUCTION"
  | "NOT_APPLICABLE"
  | "UNRESOLVED";

export type EnvironmentAttestation =
  | "PRODUCTION"
  | "NON_PRODUCTION_ATTESTED"
  | "TEST_HARNESS"
  | "UNRESOLVED";

export type ReadinessAuthorityLevel = number & { __readinessAuthorityLevel: never };

export const READINESS_AUTHORITY_HIGHEST = 0 as ReadinessAuthorityLevel;
export const READINESS_AUTHORITY_AGENT_CONFIG = 10 as ReadinessAuthorityLevel;
export const READINESS_AUTHORITY_AGENT_DEFAULTS = 20 as ReadinessAuthorityLevel;
export const READINESS_AUTHORITY_ROUTE_CLASSIFICATION = 30 as ReadinessAuthorityLevel;
export const READINESS_AUTHORITY_TEST_HARNESS = 40 as ReadinessAuthorityLevel;
export const READINESS_AUTHORITY_LOWEST = 100 as ReadinessAuthorityLevel;

export type ReadinessPolicySource = {
  sourceId: string;
  authorityLevel: ReadinessAuthorityLevel;
};

export type ReadinessPolicyCandidate = {
  sourceId: string;
  authorityLevel: ReadinessAuthorityLevel;
  mode: "required" | "disabled" | "inherit";
  applicability: "governed" | "non-model";
  disablePermittedByGoverningPolicy: boolean;
  policyId?: string;
  contractVersion?: string;
  maximumAgeMs?: number;
  projectionBindingRequired: boolean;
};

export type ReadinessPolicyResolutionInput = {
  candidates: ReadinessPolicyCandidate[];
  environmentAttestation: EnvironmentAttestation;
  now: number;
};

export type ResolvedReadinessPolicy = {
  disposition: ReadinessDisposition;
  code?: ReadinessCode;
  policyId?: string;
  contractVersion?: string;
  source: ReadinessPolicySource;
  environmentAttestation: EnvironmentAttestation;
  maximumAgeMs?: number;
  projectionBindingRequired: boolean;
  resolvedAt: number;
};

export type ReadinessContractV1 = {
  contract_version: "readiness.v1";
  decision: "READY" | "BLOCKED";
  valid_until?: string;
  classification?: string;
  reason?: string;
  diagnostic_ref?: string;
  evaluated_at?: string;
  projection_id?: string;
  projection_version?: string;
};

export type ReadinessDecision = "READY" | "BLOCKED";

export type ReadinessOutcome =
  | "EVIDENCE_READY"
  | "POLICY_BYPASS_NON_PRODUCTION"
  | "ROUTE_NOT_APPLICABLE"
  | "BLOCKED";

export type ReadinessEvaluation = {
  decision: ReadinessDecision;
  outcome: ReadinessOutcome;
  classification: string;
  diagnosticRef: string;
  evaluatedAt: number;
  policy: ResolvedReadinessPolicy;
};

export type ReadinessRunStateData = {
  policy: ResolvedReadinessPolicy;
  evaluation: ReadinessEvaluation | null;
  projectionId: string | null;
  projectionVersion: string | null;
  evaluatedAt: number;
  classification: string;
  diagnosticRef: string;
};

export type BlockedRuntimeResult = {
  classification: string;
  diagnosticRef: string;
  evaluatedAt: number;
  sanitizedMessage: string;
  isBlocked: true;
};
