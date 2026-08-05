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

export type ReadinessRouteClassification =
  | "REAL_MODEL_EXECUTION_ROUTE"
  | "TEST_MODEL_EXECUTION_ROUTE"
  | "TRUSTED_NON_MODEL_ROUTE"
  | "UNKNOWN_OR_MISSING_ROUTE";

export type ReadinessGovernance =
  | {
      governed: true;
      state: import("./state.js").ReadinessRunState;
    }
  | {
      governed: false;
      reason: "EXPLICIT_LEGACY_ROLLOUT_EXCEPTION" | "TRUSTED_NON_MODEL_ROUTE";
    };

export type GovernedReadinessProjection = {
  id: string;
  version: string;
  content: string;
  contentHash?: string;
};

export type ProjectionLoadResult =
  | { ok: true; projection: GovernedReadinessProjection }
  | { ok: false; code: string; message: string };

export type BootstrapAdapterInput = {
  governance: ReadinessGovernance;
  projection: GovernedReadinessProjection | null;
  bootstrapFiles: readonly { name: string; path: string; content?: string; missing: boolean }[];
};

export type BootstrapAdapterResult =
  | { ok: true; files: { name: string; path: string; content?: string; missing: boolean }[] }
  | { ok: false; code: string; message: string };
