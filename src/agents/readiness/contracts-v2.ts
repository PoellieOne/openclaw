export const ENVELOPE_VERSION_V2 = "readiness-envelope.v2";
export const CONTRACT_VERSION_V2 = "readiness.v2";
export const PAYLOAD_SCHEMA_VERSION = "semantic-projection-payload.v1";
export const MANIFEST_ID = "canonical-source-manifest.v1";

export const RUNTIME_PROJECTIONS_DIR = "/state/sora/runtime-projections";

/** Execution backend fact resolved from the effective runtime/config selection. */
export const ExecutionBackend = {
  OPENCLAW_EMBEDDED_PROVIDER_RUNTIME: "OPENCLAW_EMBEDDED_PROVIDER_RUNTIME",
  CLI_PROVIDER_RUNTIME: "CLI_PROVIDER_RUNTIME",
  UNRESOLVED: "UNRESOLVED",
} as const;

export type ExecutionBackend = (typeof ExecutionBackend)[keyof typeof ExecutionBackend];

/** Governed execution backend policy for the current production route. */
export const ExecutionBackendPolicy = {
  OPENCLAW_EMBEDDED_PROVIDER_RUNTIME_ONLY: "OPENCLAW_EMBEDDED_PROVIDER_RUNTIME_ONLY",
  PROHIBITED: "PROHIBITED",
  UNRESOLVED: "UNRESOLVED",
} as const;

export type ExecutionBackendPolicy =
  (typeof ExecutionBackendPolicy)[keyof typeof ExecutionBackendPolicy];

/** Governed production backend policy binding. */
export const GOVERNED_EXECUTION_BACKEND_POLICY =
  ExecutionBackendPolicy.OPENCLAW_EMBEDDED_PROVIDER_RUNTIME_ONLY;

export const EXECUTION_BACKEND_POLICY_VIOLATION_CLASSIFICATION =
  "EXECUTION_BACKEND_POLICY_VIOLATION";

/** Governed policy binding for the current production route (signed envelope truth). */
export const GOVERNED_PROVIDER_POLICY = "openai";
export const GOVERNED_MODEL_POLICY = "openai/gpt-5.6-sol";
export const GOVERNED_AUTH_METHOD_POLICY = "OPENAI_CHATGPT_CODEX_OAUTH";
export const GOVERNED_FALLBACK_POLICY = "PROHIBITED";

/** Supported validator identity for readiness.v2 envelopes. */
export const SUPPORTED_VALIDATOR_ID = "readiness-validator-v2";
export const SUPPORTED_VALIDATOR_VERSION = "1.0.0";

export const CredentialRouteStatus = {
  NOT_MATERIALIZED: "NOT_MATERIALIZED",
  NOT_VERIFIED: "NOT_VERIFIED",
  AVAILABLE_VERIFIED: "AVAILABLE_VERIFIED",
  UNAVAILABLE: "UNAVAILABLE",
  BLOCKED: "BLOCKED",
} as const;

export type CredentialRouteStatus =
  (typeof CredentialRouteStatus)[keyof typeof CredentialRouteStatus];

export const ProjectionInjectionCode = {
  MISSING: "PROJECTION_INJECTION_MISSING",
  FAILED: "PROJECTION_INJECTION_FAILED",
  DUPLICATE: "PROJECTION_INJECTION_DUPLICATE",
  CONTENT_MISMATCH: "PROJECTION_INJECTION_CONTENT_MISMATCH",
} as const;

export type ProjectionInjectionCode =
  (typeof ProjectionInjectionCode)[keyof typeof ProjectionInjectionCode];

export type SemanticProjectionReference = {
  id: string;
  version: string;
  source_digest: string;
};

export type GeneratedPayloadReference = {
  payload_id: string;
  payload_version: string;
  payload_sha256: string;
  payload_bytecount: number;
  payload_filename: string;
};

export type SourceManifestReference = {
  manifest_id: string;
  manifest_digest: string;
};

export type AgentBinding = {
  agent_id: string;
};

export type RuntimeBinding = {
  image_id: string;
  source_commit: string;
  source_tree: string;
};

export type ConfigBinding = {
  config_digest: string;
};

export type PolicyBinding = {
  provider_policy: "openai";
  model_policy: "openai/gpt-5.6-sol";
  preferred_auth_method: "OPENAI_CHATGPT_CODEX_OAUTH";
  fallback_policy: "PROHIBITED";
};

export type CredentialRoute = {
  auth_method_policy: "OPENAI_CHATGPT_CODEX_OAUTH";
  credential_route_status: CredentialRouteStatus;
};

export type ValidatorIdentity = {
  validator_id: string;
  validator_version: string;
};

export type RevalidationState = {
  revalidation_required: boolean;
  reason: string | null;
  validator_version: string;
};

export type ProjectionPreparationAssertion = {
  ok: boolean;
  payloadId: string | null;
  payloadVersion: string | null;
  expectedProjectionDigest: string | null;
  expectedBytecount: number | null;
  /** Exact validated generated-payload content read by the secure payload reader. */
  payloadContent: string | null;
  code: string | null;
};

export type ProjectionInjectionAssertion = {
  ok: boolean;
  entryCount: number;
  entryDigest: string | null;
  code: ProjectionInjectionCode | null;
};

export type InjectionAssertion = ProjectionPreparationAssertion;

export type ReadinessEnvelopeV2 = {
  envelope_version: typeof ENVELOPE_VERSION_V2;
  published_at: string;
  published_by: string;
  evidence: {
    contract_version: typeof CONTRACT_VERSION_V2;
    decision: "READY" | "BLOCKED";
    valid_until?: string;
    classification?: string;
    reason?: string;
    diagnostic_ref?: string;
    evaluated_at?: string;
  };
  projection: {
    id: string;
    version: string;
    content: string;
  };
  binding: {
    kind: "sha256";
    projection_sha256: string;
  };
  semantic_projection: SemanticProjectionReference;
  generated_payload: GeneratedPayloadReference;
  source_manifest: SourceManifestReference;
  agent_binding: AgentBinding;
  runtime_binding: RuntimeBinding;
  config_binding: ConfigBinding;
  policy_binding: PolicyBinding;
  credential_route: CredentialRoute;
  validator: ValidatorIdentity;
  revalidation: RevalidationState;
  provenance: {
    generator_id: string;
    generator_version: string;
  };
};

export type GeneratedSemanticPayloadV1 = {
  schema_version: typeof PAYLOAD_SCHEMA_VERSION;
  payload_id: string;
  payload_version: string;
  semantic_projection: SemanticProjectionReference;
  canonical_source_manifest: SourceManifestReference;
  canonical_identity: string;
  continuity_anchor: string;
  relationship_anchor: string;
  active_presence: "GENERAL_COLLABORATIVE_PRESENCE";
  internal_parent: "NOT_APPLICABLE";
  master_position_state: "NOT_ACTIVE_BY_DEFAULT";
  formal_mission_state: "NONE_UNLESS_ACTIVATED";
  consequential_execution_policy: "PROHIBITED_WITHOUT_GOVERNED_TRANSITION";
  authority_boundary: string;
  external_migration_governance_separation: string;
  provider_policy: "openai";
  model_policy: "openai/gpt-5.6-sol";
  preferred_auth_method: "OPENAI_CHATGPT_CODEX_OAUTH";
  alternative_route_policy: "DEEPSEEK_EXPLICIT_RALPH_SELECTION_ONLY";
  fallback_policy: "PROHIBITED";
  runtime_state_boundary: string;
  workspace_boundary: string;
  direct_spawn_authority_boundary: string;
  canonical_publication_boundary: string;
  security_boundary: string;
};

export function derivePayloadFilename(
  payloadId: string,
  payloadVersion: string,
  sha256Hex: string,
): string {
  return `${payloadId}@${payloadVersion}@${sha256Hex}.json`;
}
