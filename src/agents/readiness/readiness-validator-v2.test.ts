import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { validateReadinessContractV2 } from "./validator.js";
import type { ReadinessV2ValidationInput } from "./validator.js";

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

function makeInput(overrides?: Partial<ReadinessV2ValidationInput>): ReadinessV2ValidationInput {
  return {
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
    now: NOW,
    ...overrides,
  };
}

function makeReadyEnvelope(): Record<string, unknown> {
  return {
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
      content: "{}",
    },
    binding: {
      kind: "sha256",
      projection_sha256: createHash("sha256").update(Buffer.from("{}", "utf-8")).digest("hex"),
    },
    semantic_projection: {
      id: PAYLOAD_ID,
      version: "1.0.1",
      source_digest: SOURCE_DIGEST,
    },
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
    runtime_binding: {
      image_id: IMAGE_ID,
      source_commit: SOURCE_COMMIT,
      source_tree: SOURCE_TREE,
    },
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
  };
}

function validate(envelope: unknown, input?: ReadinessV2ValidationInput) {
  return validateReadinessContractV2(envelope, input ?? makeInput());
}

describe("validateReadinessContractV2", () => {
  it("accepts a fully matching V2 envelope as READY", () => {
    const result = validate(makeReadyEnvelope());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.decision).toBe("READY");
      expect(result.contract.contract_version).toBe("readiness.v2");
    }
  });

  it("rejects unsupported envelope version", () => {
    const env = makeReadyEnvelope();
    env.envelope_version = "readiness-envelope.v1";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
  });

  it("rejects unsupported contract version", () => {
    const env = makeReadyEnvelope();
    (env.evidence as Record<string, unknown>).contract_version = "readiness.v1";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
  });

  it("rejects unknown top-level key", () => {
    const env = makeReadyEnvelope();
    (env as Record<string, unknown>).unexpected = 1;
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects unknown nested key", () => {
    const env = makeReadyEnvelope();
    (env.agent_binding as Record<string, unknown>).extra = "x";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects missing READY-required valid_until", () => {
    const env = makeReadyEnvelope();
    delete (env.evidence as Record<string, unknown>).valid_until;
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects invalid timestamp", () => {
    const env = makeReadyEnvelope();
    (env.evidence as Record<string, unknown>).valid_until = "not-a-date";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_TIMESTAMP");
  });

  it("rejects expired valid_until", () => {
    const env = makeReadyEnvelope();
    (env.evidence as Record<string, unknown>).valid_until = new Date(NOW - 1000).toISOString();
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("READINESS_EXPIRED");
  });

  it("rejects semantic projection id mismatch", () => {
    const env = makeReadyEnvelope();
    (env.semantic_projection as Record<string, unknown>).id = "different";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SEMANTIC_PROJECTION_MISMATCH");
  });

  it("rejects semantic projection source digest mismatch", () => {
    const env = makeReadyEnvelope();
    (env.semantic_projection as Record<string, unknown>).source_digest = "f".repeat(64);
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SEMANTIC_PROJECTION_MISMATCH");
  });

  it("rejects malformed semantic projection source_digest", () => {
    const env = makeReadyEnvelope();
    (env.semantic_projection as Record<string, unknown>).source_digest = "not-hex";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects payload identity mismatch in filename contract", () => {
    const env = makeReadyEnvelope();
    (env.generated_payload as Record<string, unknown>).payload_filename = "wrong.json";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects malformed payload digest", () => {
    const env = makeReadyEnvelope();
    (env.generated_payload as Record<string, unknown>).payload_sha256 = "z".repeat(64);
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects invalid payload bytecount", () => {
    const env = makeReadyEnvelope();
    (env.generated_payload as Record<string, unknown>).payload_bytecount = 0;
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects payload bytecount above 65536", () => {
    const env = makeReadyEnvelope();
    (env.generated_payload as Record<string, unknown>).payload_bytecount = 65537;
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects source-manifest id mismatch", () => {
    const env = makeReadyEnvelope();
    (env.source_manifest as Record<string, unknown>).manifest_id = "other.v1";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects source-manifest digest mismatch", () => {
    const env = makeReadyEnvelope();
    (env.source_manifest as Record<string, unknown>).manifest_digest = "f".repeat(64);
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SOURCE_MANIFEST_MISMATCH");
  });

  it("rejects agent mismatch", () => {
    const env = makeReadyEnvelope();
    (env.agent_binding as Record<string, unknown>).agent_id = "other-agent";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AGENT_BINDING_MISMATCH");
  });

  it("rejects runtime image mismatch", () => {
    const env = makeReadyEnvelope();
    (env.runtime_binding as Record<string, unknown>).image_id = "sha256:other";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RUNTIME_BINDING_MISMATCH");
  });

  it("rejects source commit mismatch", () => {
    const env = makeReadyEnvelope();
    (env.runtime_binding as Record<string, unknown>).source_commit = "other";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RUNTIME_BINDING_MISMATCH");
  });

  it("rejects source tree mismatch", () => {
    const env = makeReadyEnvelope();
    (env.runtime_binding as Record<string, unknown>).source_tree = "other";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RUNTIME_BINDING_MISMATCH");
  });

  it("rejects config digest mismatch", () => {
    const env = makeReadyEnvelope();
    (env.config_binding as Record<string, unknown>).config_digest = "f".repeat(64);
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFIG_BINDING_MISMATCH");
  });

  it("rejects provider mismatch", () => {
    const env = makeReadyEnvelope();
    (env.policy_binding as Record<string, unknown>).provider_policy = "anthropic";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PROVIDER_POLICY_MISMATCH");
  });

  it("rejects model mismatch", () => {
    const env = makeReadyEnvelope();
    (env.policy_binding as Record<string, unknown>).model_policy = "openai/gpt-4o";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MODEL_POLICY_MISMATCH");
  });

  it("rejects auth method policy mismatch", () => {
    const env = makeReadyEnvelope();
    (env.policy_binding as Record<string, unknown>).preferred_auth_method = "API_KEY";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PROFILE_POLICY_MISMATCH");
  });

  it("rejects fallback policy violation", () => {
    const env = makeReadyEnvelope();
    (env.policy_binding as Record<string, unknown>).fallback_policy = "ALLOWED";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FALLBACK_POLICY_VIOLATION");
  });

  it("rejects credential route NOT_MATERIALIZED", () => {
    const env = makeReadyEnvelope();
    (env.credential_route as Record<string, unknown>).credential_route_status = "NOT_MATERIALIZED";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CREDENTIAL_ROUTE_NOT_READY");
  });

  it("rejects credential route NOT_VERIFIED", () => {
    const env = makeReadyEnvelope();
    (env.credential_route as Record<string, unknown>).credential_route_status = "NOT_VERIFIED";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CREDENTIAL_ROUTE_NOT_READY");
  });

  it("rejects credential route UNAVAILABLE", () => {
    const env = makeReadyEnvelope();
    (env.credential_route as Record<string, unknown>).credential_route_status = "UNAVAILABLE";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CREDENTIAL_ROUTE_NOT_READY");
  });

  it("rejects credential route BLOCKED", () => {
    const env = makeReadyEnvelope();
    (env.credential_route as Record<string, unknown>).credential_route_status = "BLOCKED";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CREDENTIAL_ROUTE_NOT_READY");
  });

  it("rejects unsupported validator identity", () => {
    const env = makeReadyEnvelope();
    (env.validator as Record<string, unknown>).validator_id = "other-validator";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATOR_VERSION_UNSUPPORTED");
  });

  it("rejects unsupported validator version", () => {
    const env = makeReadyEnvelope();
    (env.validator as Record<string, unknown>).validator_version = "9.9.9";
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATOR_VERSION_UNSUPPORTED");
  });

  it("rejects revalidation_required true", () => {
    const env = makeReadyEnvelope();
    (env.revalidation as Record<string, unknown>).revalidation_required = true;
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("REVALIDATION_REQUIRED");
  });

  it("accepts BLOCKED V2 envelope without bindings", () => {
    const env = {
      envelope_version: "readiness-envelope.v2",
      published_at: "2026-08-07T00:00:00.000Z",
      published_by: "governed-generator",
      evidence: {
        contract_version: "readiness.v2",
        decision: "BLOCKED",
        classification: "POLICY_REQUIRED",
      },
    };
    const result = validate(env);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.decision).toBe("BLOCKED");
    }
  });

  it("rejects BLOCKED envelope carrying projection", () => {
    const env = {
      envelope_version: "readiness-envelope.v2",
      published_at: "2026-08-07T00:00:00.000Z",
      published_by: "governed-generator",
      evidence: { contract_version: "readiness.v2", decision: "BLOCKED" },
      projection: { id: "x", version: "1", content: "{}" },
    };
    const result = validate(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects non-plain-object input", () => {
    const result = validate("string");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects __proto__ key", () => {
    const env = makeReadyEnvelope();
    (env as Record<string, unknown>).__proto__ = { pollute: true };
    const result = validate(env);
    expect(result.ok).toBe(false);
  });
});
