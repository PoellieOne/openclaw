import { describe, it, expect } from "vitest";
import {
  ENVELOPE_VERSION_V2,
  CONTRACT_VERSION_V2,
  PAYLOAD_SCHEMA_VERSION,
  MANIFEST_ID,
  CredentialRouteStatus,
  ProjectionInjectionCode,
  derivePayloadFilename,
} from "./contracts-v2.js";
import type {
  CredentialRoute,
  GeneratedPayloadReference,
  GeneratedSemanticPayloadV1,
  ProjectionInjectionAssertion,
  ProjectionPreparationAssertion,
  PolicyBinding,
  ReadinessEnvelopeV2,
} from "./contracts-v2.js";

describe("contracts-v2", () => {
  it("defines exact successor version constants", () => {
    expect(ENVELOPE_VERSION_V2).toBe("readiness-envelope.v2");
    expect(CONTRACT_VERSION_V2).toBe("readiness.v2");
    expect(PAYLOAD_SCHEMA_VERSION).toBe("semantic-projection-payload.v1");
    expect(MANIFEST_ID).toBe("canonical-source-manifest.v1");
  });

  it("defines the exact credential-route state set", () => {
    expect(Object.values(CredentialRouteStatus)).toEqual([
      "NOT_MATERIALIZED",
      "NOT_VERIFIED",
      "AVAILABLE_VERIFIED",
      "UNAVAILABLE",
      "BLOCKED",
    ]);
  });

  it("defines the exact injection code set", () => {
    expect(Object.values(ProjectionInjectionCode)).toEqual([
      "PROJECTION_INJECTION_MISSING",
      "PROJECTION_INJECTION_FAILED",
      "PROJECTION_INJECTION_DUPLICATE",
      "PROJECTION_INJECTION_CONTENT_MISMATCH",
    ]);
  });

  it("keeps V2 envelope identity structurally separate from V1", () => {
    expect(ENVELOPE_VERSION_V2).not.toBe("readiness-envelope.v1");
    expect(CONTRACT_VERSION_V2).not.toBe("readiness.v1");
  });

  it("keeps credential policy and credential-route readiness separate", () => {
    const policy: PolicyBinding = {
      provider_policy: "openai",
      model_policy: "openai/gpt-5.6-sol",
      preferred_auth_method: "OPENAI_CHATGPT_CODEX_OAUTH",
      fallback_policy: "PROHIBITED",
    };
    const route: CredentialRoute = {
      auth_method_policy: "OPENAI_CHATGPT_CODEX_OAUTH",
      credential_route_status: CredentialRouteStatus.NOT_MATERIALIZED,
    };
    expect(policy.provider_policy).toBe("openai");
    expect(route.credential_route_status).toBe("NOT_MATERIALIZED");
    expect("credential_route_status" in policy).toBe(false);
    expect("provider_policy" in route).toBe(false);
  });

  it("supports the successor envelope structure", () => {
    const envelope: ReadinessEnvelopeV2 = {
      envelope_version: ENVELOPE_VERSION_V2,
      published_at: "2026-08-07T00:00:00.000Z",
      published_by: "governed-generator",
      evidence: {
        contract_version: CONTRACT_VERSION_V2,
        decision: "READY",
        valid_until: "2026-08-08T00:00:00.000Z",
        evaluated_at: "2026-08-07T00:00:00.000Z",
      },
      projection: {
        id: "openclaw-readiness-baseline-v1",
        version: "1.0.0",
        content: "{}",
      },
      binding: {
        kind: "sha256",
        projection_sha256: "a".repeat(64),
      },
      semantic_projection: {
        id: "canonical-production-sophia-semantic-runtime-projection-v1",
        version: "1.0.1",
        source_digest: "b".repeat(64),
      },
      generated_payload: {
        payload_id: "canonical-production-sophia-semantic-runtime-projection-v1",
        payload_version: "1.0.0",
        payload_sha256: "c".repeat(64),
        payload_bytecount: 1024,
        payload_filename: derivePayloadFilename(
          "canonical-production-sophia-semantic-runtime-projection-v1",
          "1.0.0",
          "c".repeat(64),
        ),
      },
      source_manifest: {
        manifest_id: MANIFEST_ID,
        manifest_digest: "d".repeat(64),
      },
      agent_binding: { agent_id: "sophia" },
      runtime_binding: {
        image_id: "sha256:d517a31d3167013713d1fa8f632b504bf536e1282eed21bd36b88c2941b93a7a",
        source_commit: "37fd1774155e0d7a0eeef9ea7acea89b135cac82",
        source_tree: "0cde9f1fb226119ece99a2e74f918f3fee8cd523",
      },
      config_binding: { config_digest: "e".repeat(64) },
      policy_binding: {
        provider_policy: "openai",
        model_policy: "openai/gpt-5.6-sol",
        preferred_auth_method: "OPENAI_CHATGPT_CODEX_OAUTH",
        fallback_policy: "PROHIBITED",
      },
      credential_route: {
        auth_method_policy: "OPENAI_CHATGPT_CODEX_OAUTH",
        credential_route_status: CredentialRouteStatus.AVAILABLE_VERIFIED,
      },
      validator: { validator_id: "readiness-validator-v2", validator_version: "1.0.0" },
      revalidation: {
        revalidation_required: false,
        reason: null,
        validator_version: "1.0.0",
      },
      provenance: {
        generator_id: "sora-generated-projection-generator",
        generator_version: "1.0.0",
      },
    };
    expect(envelope.envelope_version).toBe("readiness-envelope.v2");
    expect(envelope.credential_route.credential_route_status).toBe("AVAILABLE_VERIFIED");
  });

  it("keeps transient credential availability out of the immutable semantic payload", () => {
    const payload: GeneratedSemanticPayloadV1 = {
      schema_version: PAYLOAD_SCHEMA_VERSION,
      payload_id: "canonical-production-sophia-semantic-runtime-projection-v1",
      payload_version: "1.0.0",
      semantic_projection: {
        id: "canonical-production-sophia-semantic-runtime-projection-v1",
        version: "1.0.1",
        source_digest: "b".repeat(64),
      },
      canonical_source_manifest: { manifest_id: MANIFEST_ID, manifest_digest: "d".repeat(64) },
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
    };
    expect(payload.schema_version).toBe("semantic-projection-payload.v1");
    expect("credential_route_status" in payload).toBe(false);
    expect("credential_route" in payload).toBe(false);
  });

  it("supports the two-stage injection assertion data contracts", () => {
    const preparation: ProjectionPreparationAssertion = {
      ok: true,
      payloadId: "canonical-production-sophia-semantic-runtime-projection-v1",
      payloadVersion: "1.0.0",
      expectedProjectionDigest: "c".repeat(64),
      expectedBytecount: 1024,
      code: null,
    };
    expect(preparation.ok).toBe(true);
    expect(preparation.expectedProjectionDigest).toBe("c".repeat(64));
    const injection: ProjectionInjectionAssertion = {
      ok: true,
      entryCount: 1,
      entryDigest: "c".repeat(64),
      code: null,
    };
    expect(injection.ok).toBe(true);
    expect(injection.entryCount).toBe(1);
    expect(preparation).not.toEqual(injection);
  });

  it("derives the exact immutable payload filename", () => {
    expect(derivePayloadFilename("payload-id", "1.0.0", "ab".repeat(32))).toBe(
      "payload-id@1.0.0@abababababababababababababababababababababababababababababababab.json",
    );
  });

  it("supports the generated payload reference contract", () => {
    const reference: GeneratedPayloadReference = {
      payload_id: "canonical-production-sophia-semantic-runtime-projection-v1",
      payload_version: "1.0.0",
      payload_sha256: "c".repeat(64),
      payload_bytecount: 1024,
      payload_filename: derivePayloadFilename(
        "canonical-production-sophia-semantic-runtime-projection-v1",
        "1.0.0",
        "c".repeat(64),
      ),
    };
    expect(reference.payload_bytecount).toBe(1024);
  });
});
