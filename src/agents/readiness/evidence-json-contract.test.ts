import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { ReadinessCode } from "./codes.js";
import { computeReadinessConfigDigest } from "./config-digest.js";
import { parseReadinessEnvelopeV2 } from "./envelope-parser.js";
import { prepareReadinessForRun } from "./run-preparation.js";
import type { ReadinessPreparationInput } from "./run-preparation.js";

/**
 * Focused regression for the readiness.v2 evidence-JSON contract mismatch.
 *
 * The loader (parseReadinessEnvelopeV2 / loadCanonicalReadinessEnvelopeV2)
 * previously surfaced only the extracted evidence sub-object as
 * `evidenceJson`, while the downstream validator validates the COMPLETE
 * serialized readiness-envelope.v2 (top-level envelope_version,
 * published_at, published_by, evidence). Every governed run therefore failed
 * readiness with EVIDENCE_MALFORMED. These tests prove the corrected
 * loader -> evaluator -> validator boundary: the loader now surfaces the
 * full envelope serialization and the full pipeline returns READY.
 */

type V2PreparationInput = NonNullable<ReadinessPreparationInput["v2"]>;

const NOW = 2000000000000;
const FUTURE = new Date(NOW + 86400000).toISOString();

const IMAGE_ID = "sha256:d517a31d3167013713d1fa8f632b504bf536e1282eed21bd36b88c2941b93a7a";
const SOURCE_COMMIT = "37fd1774155e0d7a0eeef9ea7acea89b135cac82";
const SOURCE_TREE = "0cde9f1fb226119ece99a2e74f918f3fee8cd523";
const CONFIG_DIGEST = "e".repeat(64);
const MANIFEST_DIGEST = "d".repeat(64);
const SOURCE_DIGEST = "b".repeat(64);
const PAYLOAD_SHA256 = "c".repeat(64);
const PAYLOAD_ID = "canonical-production-sophia-semantic-runtime-projection-v1";
const PAYLOAD_VERSION = "1.0.0";
const PAYLOAD_FILENAME = `${PAYLOAD_ID}@${PAYLOAD_VERSION}@${PAYLOAD_SHA256}.json`;

function makeFullEnvelopeJson(configDigest: string): string {
  const projectionContent = "{}";
  return JSON.stringify({
    envelope_version: "readiness-envelope.v2",
    published_at: "2026-08-07T00:00:00.000Z",
    published_by: "governed-generator",
    evidence: {
      contract_version: "readiness.v2",
      decision: "READY",
      valid_until: FUTURE,
      evaluated_at: "2026-08-07T00:00:00.000Z",
    },
    projection: {
      id: "openclaw-readiness-baseline-v1",
      version: "1.0.0",
      content: projectionContent,
    },
    binding: {
      kind: "sha256",
      projection_sha256: createHash("sha256")
        .update(Buffer.from(projectionContent, "utf-8"))
        .digest("hex"),
    },
    semantic_projection: { id: PAYLOAD_ID, version: "1.0.1", source_digest: SOURCE_DIGEST },
    generated_payload: {
      payload_id: PAYLOAD_ID,
      payload_version: PAYLOAD_VERSION,
      payload_sha256: PAYLOAD_SHA256,
      payload_bytecount: 1024,
      payload_filename: PAYLOAD_FILENAME,
    },
    source_manifest: {
      manifest_id: "canonical-source-manifest.v1",
      manifest_digest: MANIFEST_DIGEST,
    },
    agent_binding: { agent_id: "sophia" },
    runtime_binding: { image_id: IMAGE_ID, source_commit: SOURCE_COMMIT, source_tree: SOURCE_TREE },
    config_binding: { config_digest: configDigest },
    policy_binding: {
      provider_policy: "openai",
      model_policy: "openai/gpt-5.6-sol",
      preferred_auth_method: "OPENAI_CHATGPT_CODEX_OAUTH",
      fallback_policy: "PROHIBITED",
    },
    credential_route: {
      auth_method_policy: "OPENAI_CHATGPT_CODEX_OAUTH",
      credential_route_status: "AVAILABLE_VERIFIED",
    },
    validator: { validator_id: "readiness-validator-v2", validator_version: "1.0.0" },
    revalidation: { revalidation_required: false, reason: null, validator_version: "1.0.0" },
    provenance: { generator_id: "sora-generated-projection-generator", generator_version: "1.0.0" },
  });
}

function makeValidPayloadJson(): string {
  return JSON.stringify({
    schema_version: "semantic-projection-payload.v1",
    payload_id: PAYLOAD_ID,
    payload_version: PAYLOAD_VERSION,
    semantic_projection: { id: PAYLOAD_ID, version: "1.0.1", source_digest: SOURCE_DIGEST },
    canonical_source_manifest: {
      manifest_id: "canonical-source-manifest.v1",
      manifest_digest: MANIFEST_DIGEST,
    },
    canonical_identity: "one continuous canonical Sophia",
    continuity_anchor: "continuity anchor",
    relationship_anchor: "Ralph relationship anchor",
    active_presence: "GENERAL_COLLABORATIVE_PRESENCE",
    internal_parent: "NOT_APPLICABLE",
    master_position_state: "NOT_ACTIVE_BY_DEFAULT",
    formal_mission_state: "NONE_UNLESS_ACTIVATED",
    consequential_execution_policy: "PROHIBITED_WITHOUT_GOVERNED_TRANSITION",
    authority_boundary: "bounded authority",
    external_migration_governance_separation: "separated",
    provider_policy: "openai",
    model_policy: "openai/gpt-5.6-sol",
    preferred_auth_method: "OPENAI_CHATGPT_CODEX_OAUTH",
    alternative_route_policy: "DEEPSEEK_EXPLICIT_RALPH_SELECTION_ONLY",
    fallback_policy: "PROHIBITED",
    runtime_state_boundary: "bounded",
    workspace_boundary: "bounded",
    direct_spawn_authority_boundary: "bounded",
    canonical_publication_boundary: "bounded",
    security_boundary: "bounded",
  });
}

function writePayload(payload: string): {
  path: string;
  sha256: string;
  bytecount: number;
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-json-contract-"));
  const payloadPath = path.join(dir, "payload.json");
  const bytes = Buffer.from(payload, "utf-8");
  fs.writeFileSync(payloadPath, bytes);
  return {
    path: payloadPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytecount: bytes.byteLength,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function makeConfigInput() {
  return {
    targetAgentId: "sophia",
    defaultAgentId: "sophia",
    effectivePrimaryModel: "openai/gpt-5.6-sol",
    effectiveModelFallbacks: [],
    contextInjection: "always" as const,
    skipBootstrap: false,
    skipOptionalBootstrapFiles: [],
    workspace: "/state/sora/workspace",
    agentDir: "/state/sora/agents/sophia/agent",
    routingBindings: [],
    readinessPolicyMode: "required" as const,
    requiredReadinessContractVersion: "readiness.v2" as const,
    providerPolicy: "openai" as const,
    modelPolicy: "openai/gpt-5.6-sol" as const,
    preferredAuthMethodPolicy: "OPENAI_CHATGPT_CODEX_OAUTH" as const,
    fallbackPolicy: "PROHIBITED" as const,
    effectiveExecutionBackend: "OPENCLAW_EMBEDDED_PROVIDER_RUNTIME" as const,
    executionBackendPolicy: "OPENCLAW_EMBEDDED_PROVIDER_RUNTIME_ONLY" as const,
  };
}

function makeV2Input(payloadPath: string, configDigest: string): V2PreparationInput {
  return {
    payloadPath,
    expectedPayloadId: PAYLOAD_ID,
    expectedPayloadVersion: PAYLOAD_VERSION,
    expectedSha256: PAYLOAD_SHA256,
    expectedBytecount: 1024,
    expectedSemanticProjectionId: PAYLOAD_ID,
    expectedSemanticProjectionVersion: "1.0.1",
    expectedSemanticProjectionSourceDigest: SOURCE_DIGEST,
    expectedSourceManifestDigest: MANIFEST_DIGEST,
    validation: {
      expectedAgentId: "sophia",
      expectedImageId: IMAGE_ID,
      expectedSourceCommit: SOURCE_COMMIT,
      expectedSourceTree: SOURCE_TREE,
      expectedConfigDigest: configDigest,
      expectedProviderPolicy: "openai",
      expectedModelPolicy: "openai/gpt-5.6-sol",
      expectedAuthMethodPolicy: "OPENAI_CHATGPT_CODEX_OAUTH",
      expectedFallbackPolicy: "PROHIBITED",
      expectedSemanticProjectionId: PAYLOAD_ID,
      expectedSemanticProjectionVersion: "1.0.1",
      expectedSemanticProjectionSourceDigest: SOURCE_DIGEST,
      expectedSourceManifestDigest: MANIFEST_DIGEST,
      supportedValidatorId: "readiness-validator-v2",
      supportedValidatorVersion: "1.0.0",
    },
  };
}

describe("readiness.v2 evidence-JSON contract (loader -> evaluator -> validator)", () => {
  it("loader surfaces the COMPLETE serialized envelope, not the evidence sub-object", () => {
    const raw = makeFullEnvelopeJson(CONFIG_DIGEST);
    const loaded = parseReadinessEnvelopeV2(raw);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const parsedEnvelope = JSON.parse(loaded.envelopeJson) as Record<string, unknown>;
    expect(parsedEnvelope.envelope_version).toBe("readiness-envelope.v2");
    expect(typeof parsedEnvelope.published_at).toBe("string");
    expect(typeof parsedEnvelope.published_by).toBe("string");
    expect(parsedEnvelope.evidence).toEqual(JSON.parse(raw).evidence);
    // The sub-object alone (the former broken contract) lacks the top-level
    // keys the validator requires.
    const evidenceOnly = JSON.parse(loaded.envelopeJson) as Record<string, unknown>;
    expect(evidenceOnly).toHaveProperty("envelope_version");
  });

  it("full pipeline: valid full envelope returns READY and mayExecute=true", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const raw = makeFullEnvelopeJson(digest);
      const loaded = parseReadinessEnvelopeV2(raw);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) {
        return;
      }
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: loaded.envelopeJson,
        projectionId: loaded.projection?.id ?? null,
        projectionVersion: loaded.projection?.version ?? null,
        now: NOW,
        v2: {
          ...makeV2Input(payload.path, digest),
          expectedSha256: payload.sha256,
          expectedBytecount: payload.bytecount,
        },
        config,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.governance.governed).toBe(true);
      if (result.governance.governed) {
        expect(result.governance.state.evaluation?.decision).toBe("READY");
        expect(result.governance.state.mayExecute()).toBe(true);
      }
    } finally {
      payload.cleanup();
    }
  });

  it("fail-closed: evidence sub-object alone (former broken contract) is still BLOCKED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const raw = makeFullEnvelopeJson(digest);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const evidenceOnly = JSON.stringify(parsed.evidence);
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: evidenceOnly,
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: {
          ...makeV2Input(payload.path, digest),
          expectedSha256: payload.sha256,
          expectedBytecount: payload.bytecount,
        },
        config,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.governance.governed).toBe(true);
      if (result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.evaluation?.decision).toBe("BLOCKED");
        expect(result.governance.state.classification).toBe(ReadinessCode.EVIDENCE_MALFORMED);
      }
    } finally {
      payload.cleanup();
    }
  });

  it("fail-closed: envelope missing envelope_version remains BLOCKED EVIDENCE_MALFORMED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const parsed = JSON.parse(makeFullEnvelopeJson(digest)) as Record<string, unknown>;
      delete parsed.envelope_version;
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: JSON.stringify(parsed),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: {
          ...makeV2Input(payload.path, digest),
          expectedSha256: payload.sha256,
          expectedBytecount: payload.bytecount,
        },
        config,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.governance.governed).toBe(true);
      if (result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.evaluation?.decision).toBe("BLOCKED");
      }
    } finally {
      payload.cleanup();
    }
  });
});
