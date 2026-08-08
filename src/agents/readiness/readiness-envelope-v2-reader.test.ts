import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { parseReadinessEnvelopeV2 } from "./envelope-parser.js";

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

function makeReadyV2Envelope(): Record<string, unknown> {
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
  };
}

function serialize(envelope: Record<string, unknown>): string {
  return JSON.stringify(envelope);
}

describe("parseReadinessEnvelopeV2", () => {
  it("parses a valid V2 structure", () => {
    const result = parseReadinessEnvelopeV2(serialize(makeReadyV2Envelope()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.envelopeVersion).toBe("readiness-envelope.v2");
      expect(result.envelope.evidence.decision).toBe("READY");
      expect(result.envelope.generatedPayload.payloadId).toBe(PAYLOAD_ID);
      expect(result.envelope.credentialRoute.credentialRouteStatus).toBe("AVAILABLE_VERIFIED");
    }
  });

  it("rejects unsupported envelope version", () => {
    const env = makeReadyV2Envelope();
    env.envelope_version = "readiness-envelope.v1";
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
  });

  it("rejects unsupported contract version", () => {
    const env = makeReadyV2Envelope();
    (env.evidence as Record<string, unknown>).contract_version = "readiness.v1";
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
  });

  it("rejects unknown top-level key", () => {
    const env = makeReadyV2Envelope();
    (env as Record<string, unknown>).unexpected = 1;
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects unknown nested key", () => {
    const env = makeReadyV2Envelope();
    (env.agent_binding as Record<string, unknown>).extra = "x";
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects duplicate keys", () => {
    const json = serialize(makeReadyV2Envelope()).replace(
      '"envelope_version":"readiness-envelope.v2"',
      '"envelope_version":"readiness-envelope.v2","envelope_version":"readiness-envelope.v2"',
    );
    const result = parseReadinessEnvelopeV2(json);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_KEY");
  });

  it("rejects missing READY-required field", () => {
    const env = makeReadyV2Envelope();
    delete (env.evidence as Record<string, unknown>).valid_until;
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_TIMESTAMP");
  });

  it("rejects invalid timestamp", () => {
    const env = makeReadyV2Envelope();
    (env.evidence as Record<string, unknown>).valid_until = "not-a-date";
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_TIMESTAMP");
  });

  it("parses a structurally valid but expired valid_until (expiry is validator-owned)", () => {
    const env = makeReadyV2Envelope();
    (env.evidence as Record<string, unknown>).valid_until = new Date(NOW - 1000).toISOString();
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(true);
  });

  it("rejects leading UTF-8 BOM", () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const json = Buffer.concat([bom, Buffer.from(serialize(makeReadyV2Envelope()), "utf-8")]);
    const result = parseReadinessEnvelopeV2(json.toString("utf-8"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects invalid UTF-8", () => {
    const result = parseReadinessEnvelopeV2(Buffer.from([0x80, 0x80, 0x80]).toString("utf-8"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects payload filename violating the immutable filename contract", () => {
    const env = makeReadyV2Envelope();
    (env.generated_payload as Record<string, unknown>).payload_filename = "wrong.json";
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects payload bytecount above 65536", () => {
    const env = makeReadyV2Envelope();
    (env.generated_payload as Record<string, unknown>).payload_bytecount = 65537;
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects source manifest id mismatch", () => {
    const env = makeReadyV2Envelope();
    (env.source_manifest as Record<string, unknown>).manifest_id = "other.v1";
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects unsupported credential-route status", () => {
    const env = makeReadyV2Envelope();
    (env.credential_route as Record<string, unknown>).credential_route_status = "MAYBE";
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("parses a BLOCKED V2 envelope without projection/binding", () => {
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
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.evidence.decision).toBe("BLOCKED");
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
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("validates projection content hash binding", () => {
    const env = makeReadyV2Envelope();
    const content = "projection content";
    (env.projection as Record<string, unknown>).content = content;
    (env.binding as Record<string, unknown>).projection_sha256 = createHash("sha256")
      .update(Buffer.from(content, "utf-8"))
      .digest("hex");
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(true);
  });

  it("rejects projection content hash mismatch", () => {
    const env = makeReadyV2Envelope();
    (env.projection as Record<string, unknown>).content = "different content";
    const result = parseReadinessEnvelopeV2(serialize(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });
});
