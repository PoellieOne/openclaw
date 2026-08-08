import {
  computeBytecount,
  computeSha256,
  encodeUtf8,
  serializeCanonicalJson,
} from "./serialization.js";

export const READINESS_CONFIG_PROJECTION_SCHEMA_VERSION = "readiness-config-projection.v2";

export type ReadinessContextInjection = "always" | "continuation-skip" | "never";

export type ReadinessRoutingBindingSource = {
  type?: "route" | "acp";
  agentId: string;
  match: {
    channel: string;
    accountId?: string;
    peer?: { kind: string; id: string };
    guildId?: string;
    teamId?: string;
    roles?: readonly string[];
  };
};

export type ReadinessConfigSource = {
  targetAgentId: string;
  defaultAgentId: string | null;
  effectivePrimaryModel: string | null;
  effectiveModelFallbacks: readonly string[];
  contextInjection: ReadinessContextInjection | null;
  skipBootstrap: boolean | null;
  skipOptionalBootstrapFiles: readonly string[];
  workspace: string | null;
  agentDir: string | null;
  routingBindings: readonly ReadinessRoutingBindingSource[];
  readinessPolicyMode: string | null;
  requiredReadinessContractVersion: string | null;
  providerPolicy: string | null;
  modelPolicy: string | null;
  preferredAuthMethodPolicy: string | null;
  fallbackPolicy: string | null;
  /** Runtime-derived fact: the effective execution backend for this run. */
  effectiveExecutionBackend: import("./contracts-v2.js").ExecutionBackend;
  /** Governed expected execution backend policy. */
  executionBackendPolicy: import("./contracts-v2.js").ExecutionBackendPolicy;
};

export type ReadinessRoutingBindingProjection = {
  type: "route" | "acp" | null;
  agentId: string;
  channel: string;
  accountId: string | null;
  peerKind: string | null;
  peerId: string | null;
  guildId: string | null;
  teamId: string | null;
  roles: readonly string[];
};

export type ReadinessConfigProjectionInput = {
  targetAgentId: string;
  defaultAgentId: string | null;
  effectivePrimaryModel: string | null;
  effectiveModelFallbacks: readonly string[];
  contextInjection: ReadinessContextInjection | null;
  skipBootstrap: boolean | null;
  skipOptionalBootstrapFiles: readonly string[];
  workspace: string | null;
  agentDir: string | null;
  routingBindings: readonly ReadinessRoutingBindingProjection[];
  readinessPolicyMode: string | null;
  requiredReadinessContractVersion: string | null;
  providerPolicy: string | null;
  modelPolicy: string | null;
  preferredAuthMethodPolicy: string | null;
  fallbackPolicy: string | null;
  effectiveExecutionBackend: import("./contracts-v2.js").ExecutionBackend;
  executionBackendPolicy: import("./contracts-v2.js").ExecutionBackendPolicy;
};

export function extractReadinessConfigProjectionInput(
  source: ReadinessConfigSource,
): ReadinessConfigProjectionInput {
  return {
    targetAgentId: source.targetAgentId,
    defaultAgentId: source.defaultAgentId,
    effectivePrimaryModel: source.effectivePrimaryModel,
    effectiveModelFallbacks: [...source.effectiveModelFallbacks],
    contextInjection: source.contextInjection,
    skipBootstrap: source.skipBootstrap,
    skipOptionalBootstrapFiles: [...source.skipOptionalBootstrapFiles],
    workspace: source.workspace,
    agentDir: source.agentDir,
    routingBindings: source.routingBindings.map(projectRoutingBinding),
    readinessPolicyMode: source.readinessPolicyMode,
    requiredReadinessContractVersion: source.requiredReadinessContractVersion,
    providerPolicy: source.providerPolicy,
    modelPolicy: source.modelPolicy,
    preferredAuthMethodPolicy: source.preferredAuthMethodPolicy,
    fallbackPolicy: source.fallbackPolicy,
    effectiveExecutionBackend: source.effectiveExecutionBackend,
    executionBackendPolicy: source.executionBackendPolicy,
  };
}

function projectRoutingBinding(
  binding: ReadinessRoutingBindingSource,
): ReadinessRoutingBindingProjection {
  return {
    type: binding.type ?? null,
    agentId: binding.agentId,
    channel: binding.match.channel,
    accountId: binding.match.accountId ?? null,
    peerKind: binding.match.peer?.kind ?? null,
    peerId: binding.match.peer?.id ?? null,
    guildId: binding.match.guildId ?? null,
    teamId: binding.match.teamId ?? null,
    roles: [...(binding.match.roles ?? [])],
  };
}

export function buildReadinessConfigProjection(input: ReadinessConfigProjectionInput): string {
  return serializeCanonicalJson([
    ["schema_version", READINESS_CONFIG_PROJECTION_SCHEMA_VERSION],
    ["target_agent_id", input.targetAgentId],
    ["default_agent_id", input.defaultAgentId],
    ["effective_primary_model", input.effectivePrimaryModel],
    ["effective_model_fallbacks", [...input.effectiveModelFallbacks]],
    ["context_injection", input.contextInjection],
    ["skip_bootstrap", input.skipBootstrap],
    ["skip_optional_bootstrap_files", [...input.skipOptionalBootstrapFiles]],
    ["workspace", input.workspace],
    ["agent_dir", input.agentDir],
    ["routing_bindings", input.routingBindings.map(serializeRoutingBinding)],
    ["readiness_policy_mode", input.readinessPolicyMode],
    ["required_readiness_contract_version", input.requiredReadinessContractVersion],
    ["provider_policy", input.providerPolicy],
    ["model_policy", input.modelPolicy],
    ["preferred_auth_method_policy", input.preferredAuthMethodPolicy],
    ["fallback_policy", input.fallbackPolicy],
    ["effective_execution_backend", input.effectiveExecutionBackend],
    ["execution_backend_policy", input.executionBackendPolicy],
  ]);
}

function serializeRoutingBinding(binding: ReadinessRoutingBindingProjection): string {
  return serializeCanonicalJson([
    ["type", binding.type],
    ["agent_id", binding.agentId],
    ["channel", binding.channel],
    ["account_id", binding.accountId],
    ["peer_kind", binding.peerKind],
    ["peer_id", binding.peerId],
    ["guild_id", binding.guildId],
    ["team_id", binding.teamId],
    ["roles", [...binding.roles]],
  ]);
}

export type ReadinessConfigDigestResult = {
  projection: string;
  bytes: Uint8Array;
  sha256: string;
  bytecount: number;
};

export function computeReadinessConfigDigest(
  input: ReadinessConfigProjectionInput,
): ReadinessConfigDigestResult {
  const projection = buildReadinessConfigProjection(input);
  const bytes = encodeUtf8(projection);
  return {
    projection,
    bytes,
    sha256: computeSha256(bytes),
    bytecount: computeBytecount(bytes),
  };
}

export function computeReadinessConfigDigestFromSource(
  source: ReadinessConfigSource,
): ReadinessConfigDigestResult {
  return computeReadinessConfigDigest(extractReadinessConfigProjectionInput(source));
}
