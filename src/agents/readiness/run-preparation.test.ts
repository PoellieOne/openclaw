import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { ReadinessCode } from "./codes.js";
import { computeReadinessConfigDigest } from "./config-digest.js";
import type { ReadinessConfigProjectionInput } from "./config-digest.js";
import {
  RevalidationMechanism,
  RevalidationTrigger,
  resolveRevalidationMechanism,
} from "./revalidation.js";
import { prepareReadinessForRun } from "./run-preparation.js";
import type { ReadinessPreparationInput } from "./run-preparation.js";
import { RuntimeProvenanceCode } from "./runtime-provenance.js";

/**
 * ReadinessPreparationInput["v2"] is an indexed access on an optional
 * property, so it includes `undefined`; spreading such a value makes every
 * field optional and `.validation` potentially undefined. The exact
 * v2-preparation contract is the non-nullable indexed type.
 */
type V2PreparationInput = NonNullable<ReadinessPreparationInput["v2"]>;

const NOW = 2000000000000;
const FUTURE = new Date(NOW + 86400000).toISOString();

const IMAGE_ID = "sha256:d517a31d3167013713d1fa8f632b504bf536e1282eed21bd36b88c2941b93a7a";
const SOURCE_COMMIT = "37fd1774155e0d7a0eeef9ea7acea89b135cac82";
const SOURCE_TREE = "0cde9f1fb226119ece99a2e74f918f3fee8cd523";
const MANIFEST_DIGEST = "d".repeat(64);
const SOURCE_DIGEST = "b".repeat(64);
const PAYLOAD_SHA256 = "c".repeat(64);
const PAYLOAD_ID = "canonical-production-sophia-semantic-runtime-projection-v1";
const PAYLOAD_VERSION = "1.0.0";
const PAYLOAD_FILENAME = `${PAYLOAD_ID}@${PAYLOAD_VERSION}@${PAYLOAD_SHA256}.json`;

function makeConfigInput(
  overrides?: Partial<ReadinessConfigProjectionInput>,
): ReadinessConfigProjectionInput {
  return {
    targetAgentId: "sophia",
    defaultAgentId: "sophia",
    effectivePrimaryModel: "openai/gpt-5.6-sol",
    effectiveModelFallbacks: ["openai/gpt-5.6-luna"],
    contextInjection: "always",
    skipBootstrap: false,
    skipOptionalBootstrapFiles: ["SOUL.md", "USER.md"],
    workspace: "/state/sora/workspace",
    agentDir: "/state/sora/agents/sophia/agent",
    routingBindings: [
      {
        type: "route",
        agentId: "sophia",
        channel: "telegram",
        accountId: null,
        peerKind: null,
        peerId: null,
        guildId: null,
        teamId: null,
        roles: [],
      },
    ],
    readinessPolicyMode: "required",
    requiredReadinessContractVersion: "readiness.v2",
    providerPolicy: "openai",
    modelPolicy: "openai/gpt-5.6-sol",
    preferredAuthMethodPolicy: "OPENAI_CHATGPT_CODEX_OAUTH",
    fallbackPolicy: "PROHIBITED",
    effectiveExecutionBackend: "OPENCLAW_EMBEDDED_PROVIDER_RUNTIME",
    executionBackendPolicy: "OPENCLAW_EMBEDDED_PROVIDER_RUNTIME_ONLY",
    ...overrides,
  };
}

function makeV2Evidence(configDigest: string): string {
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
  const fs = require("node:fs");
  const os = require("node:os");
  const pathModule = require("node:path");
  const dir = fs.mkdtempSync(pathModule.join(os.tmpdir(), "i5-stage-a-"));
  const path = pathModule.join(dir, "payload.json");
  const bytes = Buffer.from(payload, "utf-8");
  fs.writeFileSync(path, bytes);
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytecount: bytes.byteLength,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function withRealPayload(
  v2: V2PreparationInput,
  payload: { sha256: string; bytecount: number },
): V2PreparationInput {
  return { ...v2, expectedSha256: payload.sha256, expectedBytecount: payload.bytecount };
}

function makeReadyEvidence(): string {
  return JSON.stringify({
    contract_version: "readiness.v1",
    decision: "READY",
    valid_until: FUTURE,
    projection_id: "test-proj",
    projection_version: "1.0.0",
  });
}

function makeBlockedEvidence(): string {
  return JSON.stringify({
    contract_version: "readiness.v1",
    decision: "BLOCKED",
    classification: "POLICY_REQUIRED",
  });
}

describe("prepareReadinessForRun", () => {
  it("V1 READY evidence on the production route is BLOCKED (successor policy selected)", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: makeReadyEvidence(),
      projectionId: "test-proj",
      projectionVersion: "1.0.0",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.governance.governed).toBe(true);
      if (result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
      }
    }
  });

  it("BLOCKED evidence produces governed blocked state", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: makeBlockedEvidence(),
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.governance.governed).toBe(true);
      if (result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
      }
    }
  });

  it("missing evidence blocks", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: null,
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.mayExecute()).toBe(false);
    }
  });

  it("malformed evidence blocks", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: "{invalid}",
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.mayExecute()).toBe(false);
    }
  });

  it("expired evidence blocks", () => {
    const past = new Date(NOW - 86400000).toISOString();
    const evidence = JSON.stringify({
      contract_version: "readiness.v1",
      decision: "READY",
      valid_until: past,
    });
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: evidence,
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.mayExecute()).toBe(false);
    }
  });

  it("projection binding mismatch blocks", () => {
    const evidence = JSON.stringify({
      contract_version: "readiness.v1",
      decision: "READY",
      valid_until: FUTURE,
      projection_id: "wrong",
    });
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: evidence,
      projectionId: "expected",
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.mayExecute()).toBe(false);
    }
  });

  it("unresolved policy blocks", () => {
    const result = prepareReadinessForRun({
      routeClassification: "UNKNOWN_OR_MISSING_ROUTE",
      evidenceJson: null,
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.mayExecute()).toBe(false);
    }
  });

  it("non-model route returns governed:false", () => {
    const result = prepareReadinessForRun({
      routeClassification: "TRUSTED_NON_MODEL_ROUTE",
      evidenceJson: null,
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.governance.governed).toBe(false);
    }
  });

  it("test harness route produces governed state", () => {
    const result = prepareReadinessForRun({
      routeClassification: "TEST_MODEL_EXECUTION_ROUTE",
      evidenceJson: makeReadyEvidence(),
      projectionId: "test-proj",
      projectionVersion: "1.0.0",
      isTestHarness: true,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.governance.governed).toBe(true);
    }
  });

  it("errors are sanitized", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: null,
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.classification).toBeTruthy();
    }
  });

  it("I5: matching config digest -> Stage A READY with expectedConfigDigest", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: withRealPayload(makeV2Input(payload.path, digest), payload),
        config,
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(true);
        expect(result.governance.state.expectedConfigDigest).toBe(digest);
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I5: config change -> CONFIG_BINDING_MISMATCH BLOCKED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const changedConfig = makeConfigInput({ effectivePrimaryModel: "openai/gpt-5.6-luna" });
    const changedDigest = computeReadinessConfigDigest(changedConfig).sha256;
    expect(changedDigest).not.toBe(digest);
    const payload = writePayload(makeValidPayloadJson());
    try {
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: makeV2Input(payload.path, changedDigest),
        config: changedConfig,
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.classification).toBe("CONFIG_BINDING_MISMATCH");
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I5: payload change -> BLOCKED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const base = withRealPayload(makeV2Input(payload.path, digest), payload);
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: {
          ...base,
          expectedSha256: "f".repeat(64),
        },
        config,
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.projectionPreparation?.ok).toBe(false);
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I5: manifest change -> BLOCKED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const base = withRealPayload(makeV2Input(payload.path, digest), payload);
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: {
          ...base,
          expectedSourceManifestDigest: "a".repeat(64),
        },
        config,
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I6: semantic source digest change -> SEMANTIC_PROJECTION_MISMATCH BLOCKED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const base = withRealPayload(makeV2Input(payload.path, digest), payload);
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: {
          ...base,
          expectedSemanticProjectionSourceDigest: "f".repeat(64),
          validation: {
            ...base.validation,
            expectedSemanticProjectionSourceDigest: "f".repeat(64),
          },
        },
        config,
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.classification).toBe("SEMANTIC_PROJECTION_MISMATCH");
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I5: agent change -> BLOCKED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const base = withRealPayload(makeV2Input(payload.path, digest), payload);
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: {
          ...base,
          validation: {
            ...base.validation,
            expectedAgentId: "other-agent",
          },
        },
        config,
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.classification).toBe("AGENT_BINDING_MISMATCH");
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I5: provider/model/auth/fallback change -> BLOCKED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    const base = withRealPayload(makeV2Input(payload.path, digest), payload);
    const cases: Array<[string, Partial<typeof base.validation>]> = [
      ["PROVIDER_POLICY_MISMATCH", { expectedProviderPolicy: "anthropic" }],
      ["MODEL_POLICY_MISMATCH", { expectedModelPolicy: "openai/gpt-4o" }],
      ["PROFILE_POLICY_MISMATCH", { expectedAuthMethodPolicy: "API_KEY" }],
      ["FALLBACK_POLICY_VIOLATION", { expectedFallbackPolicy: "ALLOWED" }],
    ];
    try {
      for (const [code, override] of cases) {
        const result = prepareReadinessForRun({
          routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
          evidenceJson: makeV2Evidence(digest),
          projectionId: null,
          projectionVersion: null,
          now: NOW,
          v2: {
            ...base,
            validation: { ...base.validation, ...override },
          },
          config,
        });
        expect(result.ok).toBe(true);
        if (result.ok && result.governance.governed) {
          expect(result.governance.state.mayExecute()).toBe(false);
          expect(result.governance.state.classification).toBe(code);
        }
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I5: validator version change -> BLOCKED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const base = withRealPayload(makeV2Input(payload.path, digest), payload);
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: {
          ...base,
          validation: {
            ...base.validation,
            supportedValidatorVersion: "9.9.9",
          },
        },
        config,
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.classification).toBe("VALIDATOR_VERSION_UNSUPPORTED");
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I5: revalidation_required=true -> BLOCKED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const evidence = JSON.parse(makeV2Evidence(digest)) as Record<string, unknown>;
    (evidence.revalidation as Record<string, unknown>).revalidation_required = true;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: JSON.stringify(evidence),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: withRealPayload(makeV2Input(payload.path, digest), payload),
        config,
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.classification).toBe("REVALIDATION_REQUIRED");
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I5: new run -> fresh Stage A", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const input = (): ReadinessPreparationInput => ({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        revalidationTrigger: RevalidationTrigger.NEW_RUN_OR_SESSION,
        v2: withRealPayload(makeV2Input(payload.path, digest), payload),
        config,
      });
      const first = prepareReadinessForRun(input());
      const second = prepareReadinessForRun(input());
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok && first.governance.governed && second.governance.governed) {
        expect(first.governance.state).not.toBe(second.governance.state);
        expect(first.governance.state.mayExecute()).toBe(true);
        expect(second.governance.state.mayExecute()).toBe(true);
        expect(second.governance.state.revalidationMechanism).toBe(
          RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING,
        );
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I5: same-session new run -> no old Stage-A reuse", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const first = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: withRealPayload(makeV2Input(payload.path, digest), payload),
        config,
      });
      const second = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: withRealPayload(makeV2Input(payload.path, digest), payload),
        config,
      });
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok && first.governance.governed && second.governance.governed) {
        expect(first.governance.state).not.toBe(second.governance.state);
        expect(first.governance.state.projectionPreparation).not.toBe(
          second.governance.state.projectionPreparation,
        );
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I5: runtime image trigger -> DEFERRED_RUNTIME_VERIFICATION", () => {
    const result = resolveRevalidationMechanism(
      RevalidationTrigger.RUNTIME_IMAGE_CHANGE_OR_RESTART,
    );
    expect(result.mechanism).toBe(RevalidationMechanism.DEFERRED_RUNTIME_VERIFICATION);
  });

  it("I5: cache mismatch -> DIAGNOSTIC_ONLY", () => {
    const result = resolveRevalidationMechanism(RevalidationTrigger.CACHE_MISMATCH);
    expect(result.mechanism).toBe(RevalidationMechanism.DIAGNOSTIC_ONLY);
  });

  it("I6E: missing runtime provenance -> governed BLOCKED before evaluation", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: withRealPayload(makeV2Input(payload.path, digest), payload),
        config,
        runtimeImageTruth: {
          ok: false,
          code: RuntimeProvenanceCode.PROVENANCE_MISSING,
          message: "OPENCLAW_RUNTIME_IMAGE_ID is not set",
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.classification).toBe(
          RuntimeProvenanceCode.PROVENANCE_MISSING,
        );
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I6E: malformed runtime provenance -> governed BLOCKED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: withRealPayload(makeV2Input(payload.path, digest), payload),
        config,
        runtimeImageTruth: {
          ok: false,
          code: RuntimeProvenanceCode.PROVENANCE_MALFORMED,
          message: "OPENCLAW_RUNTIME_IMAGE_ID must match ^sha256:[0-9a-f]{64}$",
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.classification).toBe(
          RuntimeProvenanceCode.PROVENANCE_MALFORMED,
        );
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I6E: resolved runtime provenance reaches later gate logic", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: withRealPayload(makeV2Input(payload.path, digest), payload),
        config,
        runtimeImageTruth: {
          ok: true,
          truth: {
            imageId: IMAGE_ID,
            sourceCommit: SOURCE_COMMIT,
            sourceTree: SOURCE_TREE,
          },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(true);
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I6E: runtime image mismatch -> RUNTIME_BINDING_MISMATCH BLOCKED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const base = makeV2Input(payload.path, digest);
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: withRealPayload(
          {
            ...base,
            validation: {
              ...base.validation,
              expectedImageId: "sha256:" + "a".repeat(64),
            },
          },
          payload,
        ),
        config,
        runtimeImageTruth: {
          ok: true,
          truth: { imageId: IMAGE_ID, sourceCommit: SOURCE_COMMIT, sourceTree: SOURCE_TREE },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.classification).toBe("RUNTIME_BINDING_MISMATCH");
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I6E: runtime commit mismatch -> RUNTIME_BINDING_MISMATCH BLOCKED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const base = makeV2Input(payload.path, digest);
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: withRealPayload(
          {
            ...base,
            validation: {
              ...base.validation,
              expectedSourceCommit: "a".repeat(40),
            },
          },
          payload,
        ),
        config,
        runtimeImageTruth: {
          ok: true,
          truth: { imageId: IMAGE_ID, sourceCommit: SOURCE_COMMIT, sourceTree: SOURCE_TREE },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.classification).toBe("RUNTIME_BINDING_MISMATCH");
      }
    } finally {
      payload.cleanup();
    }
  });

  it("I6E: runtime tree mismatch -> RUNTIME_BINDING_MISMATCH BLOCKED", () => {
    const config = makeConfigInput();
    const digest = computeReadinessConfigDigest(config).sha256;
    const payload = writePayload(makeValidPayloadJson());
    try {
      const base = makeV2Input(payload.path, digest);
      const result = prepareReadinessForRun({
        routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
        evidenceJson: makeV2Evidence(digest),
        projectionId: null,
        projectionVersion: null,
        now: NOW,
        v2: withRealPayload(
          {
            ...base,
            validation: {
              ...base.validation,
              expectedSourceTree: "a".repeat(40),
            },
          },
          payload,
        ),
        config,
        runtimeImageTruth: {
          ok: true,
          truth: { imageId: IMAGE_ID, sourceCommit: SOURCE_COMMIT, sourceTree: SOURCE_TREE },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.classification).toBe("RUNTIME_BINDING_MISMATCH");
      }
    } finally {
      payload.cleanup();
    }
  });
});
