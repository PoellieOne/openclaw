import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { ReadinessCode } from "./codes.js";
import { evaluateReadinessV2 } from "./evaluator.js";
import type { ResolvedReadinessPolicy, ReadinessAuthorityLevel } from "./types.js";

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

function makePolicy(
  overrides: Partial<ResolvedReadinessPolicy> & {
    disposition: ResolvedReadinessPolicy["disposition"];
  },
): ResolvedReadinessPolicy {
  return {
    source: { sourceId: "test", authorityLevel: 10 as ReadinessAuthorityLevel },
    environmentAttestation: "PRODUCTION",
    projectionBindingRequired: false,
    resolvedAt: NOW,
    ...overrides,
  };
}

function makeV2Input() {
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
  };
}

function makeReadyV2Evidence(): string {
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

describe("evaluateReadinessV2", () => {
  it("REQUIRED with fully matching V2 evidence returns READY", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const result = evaluateReadinessV2(policy, makeReadyV2Evidence(), makeV2Input(), NOW);
    expect(result.decision).toBe("READY");
    expect(result.outcome).toBe("EVIDENCE_READY");
  });

  it("REQUIRED with missing evidence returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const result = evaluateReadinessV2(policy, null, makeV2Input(), NOW);
    expect(result.outcome).toBe("BLOCKED");
    expect(result.classification).toBe(ReadinessCode.EVIDENCE_MISSING);
  });

  it("REQUIRED with malformed evidence returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const result = evaluateReadinessV2(policy, "{invalid}", makeV2Input(), NOW);
    expect(result.outcome).toBe("BLOCKED");
  });

  it("REQUIRED with expired evidence returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const past = new Date(NOW - 86400000).toISOString();
    const evidence = makeReadyV2Evidence().replace(FUTURE, past);
    const result = evaluateReadinessV2(policy, evidence, makeV2Input(), NOW);
    expect(result.outcome).toBe("BLOCKED");
    expect(result.classification).toBe(ReadinessCode.READINESS_EXPIRED);
  });

  it("REQUIRED with credential NOT_MATERIALIZED returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const evidence = makeReadyV2Evidence().replace(
      '"credential_route_status":"AVAILABLE_VERIFIED"',
      '"credential_route_status":"NOT_MATERIALIZED"',
    );
    const result = evaluateReadinessV2(policy, evidence, makeV2Input(), NOW);
    expect(result.outcome).toBe("BLOCKED");
    expect(result.classification).toBe("CREDENTIAL_ROUTE_NOT_READY");
  });

  it("REQUIRED with agent mismatch returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const evidence = makeReadyV2Evidence().replace('"agent_id":"sophia"', '"agent_id":"other"');
    const result = evaluateReadinessV2(policy, evidence, makeV2Input(), NOW);
    expect(result.outcome).toBe("BLOCKED");
    expect(result.classification).toBe("AGENT_BINDING_MISMATCH");
  });

  it("REQUIRED with provider mismatch returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const evidence = makeReadyV2Evidence().replace(
      '"provider_policy":"openai"',
      '"provider_policy":"anthropic"',
    );
    const result = evaluateReadinessV2(policy, evidence, makeV2Input(), NOW);
    expect(result.outcome).toBe("BLOCKED");
    expect(result.classification).toBe("PROVIDER_POLICY_MISMATCH");
  });

  it("REQUIRED with revalidation required returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const evidence = makeReadyV2Evidence().replace(
      '"revalidation_required":false',
      '"revalidation_required":true',
    );
    const result = evaluateReadinessV2(policy, evidence, makeV2Input(), NOW);
    expect(result.outcome).toBe("BLOCKED");
    expect(result.classification).toBe("REVALIDATION_REQUIRED");
  });

  it("UNRESOLVED blocks possible execution", () => {
    const policy = makePolicy({ disposition: "UNRESOLVED" });
    const result = evaluateReadinessV2(policy, makeReadyV2Evidence(), makeV2Input(), NOW);
    expect(result.outcome).toBe("BLOCKED");
  });

  it("NOT_APPLICABLE returns ROUTE_NOT_APPLICABLE", () => {
    const policy = makePolicy({ disposition: "NOT_APPLICABLE" });
    const result = evaluateReadinessV2(policy, null, makeV2Input(), NOW);
    expect(result.outcome).toBe("ROUTE_NOT_APPLICABLE");
    expect(result.decision).toBe("READY");
  });

  it("EXPLICITLY_DISABLED_NON_PRODUCTION returns POLICY_BYPASS_NON_PRODUCTION", () => {
    const policy = makePolicy({ disposition: "EXPLICITLY_DISABLED_NON_PRODUCTION" });
    const result = evaluateReadinessV2(policy, null, makeV2Input(), NOW);
    expect(result.outcome).toBe("POLICY_BYPASS_NON_PRODUCTION");
    expect(result.decision).toBe("READY");
  });

  it("REQUIRED with BLOCKED contract returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const evidence = JSON.stringify({
      envelope_version: "readiness-envelope.v2",
      published_at: "2026-08-07T00:00:00.000Z",
      published_by: "governed-generator",
      evidence: {
        contract_version: "readiness.v2",
        decision: "BLOCKED",
        classification: "POLICY_REQUIRED",
      },
    });
    const result = evaluateReadinessV2(policy, evidence, makeV2Input(), NOW);
    expect(result.outcome).toBe("BLOCKED");
  });

  it("REQUIRED with duplicate key evidence returns BLOCKED", () => {
    const policy = makePolicy({ disposition: "REQUIRED" });
    const evidence =
      '{"envelope_version":"readiness-envelope.v2","envelope_version":"readiness-envelope.v2"}';
    const result = evaluateReadinessV2(policy, evidence, makeV2Input(), NOW);
    expect(result.outcome).toBe("BLOCKED");
    expect(result.classification).toBe(ReadinessCode.DUPLICATE_KEY);
  });
});
