import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { ReadinessCode } from "./codes.js";
import { prepareReadinessForRun } from "./run-preparation.js";
import type { ReadinessPreparationInput } from "./run-preparation.js";

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

function makeV2Evidence(): string {
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
    projection: { id: "openclaw-readiness-baseline-v1", version: "1.0.0", content: "{}" },
    binding: {
      kind: "sha256",
      projection_sha256: createHash("sha256").update(Buffer.from("{}", "utf-8")).digest("hex"),
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
    config_binding: { config_digest: CONFIG_DIGEST },
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

function makeV2Input(payloadPath: string): ReadinessPreparationInput["v2"] {
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
      expectedConfigDigest: CONFIG_DIGEST,
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

describe("I4 Stage A preparation gate", () => {
  it("Stage A failed (payload missing) -> gate 1 BLOCKED", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: makeV2Evidence(),
      projectionId: null,
      projectionVersion: null,
      now: NOW,
      v2: makeV2Input("/nonexistent/payload.json"),
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.mayExecute()).toBe(false);
      expect(result.governance.state.projectionPreparation?.ok).toBe(false);
    }
  });

  it("Stage A ok with valid payload -> gate 1 mayExecute eligible", () => {
    const payload = makeValidPayloadJson();
    const bytes = Buffer.from(payload, "utf-8");
    const fs = require("node:fs");
    const os = require("node:os");
    const pathModule = require("node:path");
    const dir = fs.mkdtempSync(pathModule.join(os.tmpdir(), "i4-stage-a-"));
    const path = pathModule.join(dir, "payload.json");
    fs.writeFileSync(path, bytes);
    try {
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: {
          ...makeV2Input(path),
          expectedSha256: createHash("sha256").update(bytes).digest("hex"),
          expectedBytecount: bytes.byteLength,
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(true);
        expect(result.governance.state.projectionPreparation?.ok).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("V1 evidence on production route remains BLOCKED (successor policy)", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: JSON.stringify({
        contract_version: "readiness.v1",
        decision: "READY",
        valid_until: FUTURE,
        projection_id: "test-proj",
        projection_version: "1.0.0",
      }),
      projectionId: "test-proj",
      projectionVersion: "1.0.0",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.mayExecute()).toBe(false);
    }
  });
});
