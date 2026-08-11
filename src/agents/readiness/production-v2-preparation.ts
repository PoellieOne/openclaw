/**
 * Production governed V2 readiness preparation input builder.
 *
 * Builds the complete v2 expected-input block from the canonical
 * readiness-envelope.v2 plus the effective run configuration, and the
 * run-local projection holder the bootstrap hook consumes. V2-only on the
 * real model execution route; runtime identity and credential truth remain
 * externally governed (BLOCKED when unavailable, never fabricated).
 */
import type { SessionEntry } from "../../config/sessions.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { modelKey } from "../../shared/model-key.js";
import { resolveDefaultAgentId } from "../agent-scope.js";
import { resolveEffectiveModelFallbacks } from "../agent-scope.js";
import { resolveContextInjectionMode } from "../bootstrap-files.js";
import { normalizeModelRef } from "../model-ref-shared.js";
import type { RunLocalProjectionState } from "./bootstrap-adapter-wiring.js";
import type { ReadinessConfigProjectionInput, ReadinessConfigSource } from "./config-digest.js";
import {
  extractReadinessConfigProjectionInput,
  computeReadinessConfigDigest,
} from "./config-digest.js";
import {
  ExecutionBackendPolicy,
  GOVERNED_PROVIDER_POLICY,
  GOVERNED_MODEL_POLICY,
  GOVERNED_AUTH_METHOD_POLICY,
  GOVERNED_FALLBACK_POLICY,
  RUNTIME_PROJECTIONS_DIR,
  derivePayloadFilename,
} from "./contracts-v2.js";
import type { ReadyV2CanonicalReadinessEnvelope } from "./envelope-parser.js";
import { resolveGovernedExecutionBackendForRun } from "./execution-backend.js";
import type { ReadinessPreparationInput } from "./run-preparation.js";
import type { ReadinessGovernance } from "./types.js";

export type GovernedV2PreparationInput = ReadinessPreparationInput["v2"];

export type GovernedRunProjectionHolder = {
  governance: ReadinessGovernance;
  runLocalProjectionState: RunLocalProjectionState;
};

/**
 * Canonicalizes the effective runtime model reference for the readiness
 * config projection. The runtime resolves model ids in short form
 * (e.g. `gpt-5.6-sol`) while the canonical readiness contract binds the
 * fully-qualified provider/model identity (e.g. `openai/gpt-5.6-sol`).
 * The config digest is verbatim-sensitive, so the reference must be
 * canonicalized before digest formation or every governed run fails
 * CONFIG_BINDING_MISMATCH. A model id that already carries a different
 * provider namespace is left untouched so a foreign provider ref can never
 * be silently re-bound to this provider's identity.
 */
export function canonicalizeReadinessModelRef(provider: string, model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return trimmed;
  }
  const normalized = normalizeModelRef(provider, trimmed);
  if (normalized.model.includes("/")) {
    return trimmed;
  }
  return modelKey(normalized.provider, normalized.model);
}

/** Builds the readiness config projection source from the effective run config. */
export function buildGovernedReadinessConfigSource(params: {
  cfg?: OpenClawConfig;
  agentId: string;
  sessionKey?: string;
  provider: string;
  model: string;
  workspaceDir: string;
  agentDir: string;
  sessionEntry?: Pick<
    SessionEntry,
    "agentHarnessId" | "agentRuntimeOverride" | "modelSelectionLocked"
  >;
  authProfileId?: string;
  channel?: string;
}): ReadinessConfigSource {
  const fallbacks =
    resolveEffectiveModelFallbacks({
      cfg: params.cfg ?? {},
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      hasSessionModelOverride: false,
    }) ?? [];
  return {
    targetAgentId: params.agentId,
    defaultAgentId: resolveDefaultAgentId(params.cfg ?? {}),
    effectivePrimaryModel: canonicalizeReadinessModelRef(params.provider, params.model),
    effectiveModelFallbacks: fallbacks,
    contextInjection: resolveContextInjectionMode(params.cfg, params.agentId),
    skipBootstrap: params.cfg?.agents?.defaults?.skipBootstrap ?? false,
    skipOptionalBootstrapFiles: [
      ...(params.cfg?.agents?.defaults?.skipOptionalBootstrapFiles ?? []),
    ],
    workspace: params.workspaceDir,
    agentDir: params.agentDir,
    routingBindings: [
      {
        type: "route",
        agentId: params.agentId,
        match: {
          channel: params.channel ?? "",
        },
      },
    ],
    readinessPolicyMode: "required",
    requiredReadinessContractVersion: "readiness.v2",
    providerPolicy: GOVERNED_PROVIDER_POLICY,
    modelPolicy: GOVERNED_MODEL_POLICY,
    preferredAuthMethodPolicy: GOVERNED_AUTH_METHOD_POLICY,
    fallbackPolicy: GOVERNED_FALLBACK_POLICY,
    effectiveExecutionBackend: resolveGovernedExecutionBackendForRun({
      cfg: params.cfg,
      provider: params.provider,
      modelId: params.model,
      fallbackModelIds: fallbacks,
      agentId: params.agentId,
      sessionEntry: params.sessionEntry,
      authProfileId: params.authProfileId,
    }),
    executionBackendPolicy: ExecutionBackendPolicy.OPENCLAW_EMBEDDED_PROVIDER_RUNTIME_ONLY,
  };
}

export function buildGovernedConfigProjectionInput(
  source: ReadinessConfigSource,
): ReadinessConfigProjectionInput {
  return extractReadinessConfigProjectionInput(source);
}

/** Computes the expected config digest for the governed production run. */
export function computeGovernedExpectedConfigDigest(source: ReadinessConfigSource): string {
  return computeReadinessConfigDigest(extractReadinessConfigProjectionInput(source)).sha256;
}

/**
 * Builds the complete v2 expected-input block from the V2 envelope.
 * Runtime identity and credential truth are read from the envelope only;
 * they are never self-attested here. Runtime image/source truth must be
 * supplied as exact resolved provenance (never null/unresolved).
 */
export function buildGovernedV2PreparationInput(params: {
  envelope: ReadyV2CanonicalReadinessEnvelope;
  agentId: string;
  expectedImageId: string;
  expectedSourceCommit: string;
  expectedSourceTree: string;
  expectedConfigDigest: string;
  supportedValidatorId: string;
  supportedValidatorVersion: string;
  now: number;
}): GovernedV2PreparationInput {
  const { envelope } = params;
  return {
    payloadPath: `${RUNTIME_PROJECTIONS_DIR}/${derivePayloadFilename(
      envelope.generatedPayload.payloadId,
      envelope.generatedPayload.payloadVersion,
      envelope.generatedPayload.payloadSha256,
    )}`,
    expectedPayloadId: envelope.generatedPayload.payloadId,
    expectedPayloadVersion: envelope.generatedPayload.payloadVersion,
    expectedSha256: envelope.generatedPayload.payloadSha256,
    expectedBytecount: envelope.generatedPayload.payloadBytecount,
    expectedSemanticProjectionId: envelope.semanticProjection.id,
    expectedSemanticProjectionVersion: envelope.semanticProjection.version,
    expectedSemanticProjectionSourceDigest: envelope.semanticProjection.sourceDigest,
    expectedSourceManifestDigest: envelope.sourceManifest.manifestDigest,
    validation: {
      expectedAgentId: params.agentId,
      expectedImageId: params.expectedImageId,
      expectedSourceCommit: params.expectedSourceCommit,
      expectedSourceTree: params.expectedSourceTree,
      expectedConfigDigest: params.expectedConfigDigest,
      expectedProviderPolicy: envelope.policyBinding.providerPolicy,
      expectedModelPolicy: envelope.policyBinding.modelPolicy,
      expectedAuthMethodPolicy: envelope.policyBinding.preferredAuthMethod,
      expectedFallbackPolicy: envelope.policyBinding.fallbackPolicy,
      expectedSemanticProjectionId: envelope.semanticProjection.id,
      expectedSemanticProjectionVersion: envelope.semanticProjection.version,
      expectedSemanticProjectionSourceDigest: envelope.semanticProjection.sourceDigest,
      expectedSourceManifestDigest: envelope.sourceManifest.manifestDigest,
      supportedValidatorId: params.supportedValidatorId,
      supportedValidatorVersion: params.supportedValidatorVersion,
    },
  };
}

/**
 * Assembles the run-local projection holder shared by reference through the
 * run carrier chain. The projection content is the exact generated payload
 * content validated by the payload reader, never envelope.projection.content.
 */
export function assembleGovernedRunLocalHolder(params: {
  governance: ReadinessGovernance;
  preparation: RunLocalProjectionState["preparation"];
}): GovernedRunProjectionHolder {
  const preparation = params.preparation;
  const projection =
    preparation.ok && preparation.payloadContent !== null
      ? {
          id: preparation.payloadId ?? "",
          version: preparation.payloadVersion ?? "",
          content: preparation.payloadContent,
        }
      : null;
  return {
    governance: params.governance,
    runLocalProjectionState: {
      governance: params.governance,
      preparation,
      projection,
      injection: {
        ok: false,
        entryCount: 0,
        entryDigest: null,
        code: "PROJECTION_INJECTION_MISSING",
      },
    },
  };
}
