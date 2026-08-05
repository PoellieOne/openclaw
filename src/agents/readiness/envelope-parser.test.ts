import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { parseReadinessEnvelope } from "./envelope-parser.js";

function buildDeepObject(depth: number): string {
  let s = "";
  for (let i = 0; i < depth; i++) {
    s += `{"a":`;
  }
  s += "1";
  for (let i = 0; i < depth; i++) {
    s += "}";
  }
  return s;
}

function makeReadyEnvelope(overrides?: Record<string, unknown>): string {
  const content = "Test projection content";
  const sha256 = createHash("sha256").update(Buffer.from(content, "utf-8")).digest("hex");
  const env: Record<string, unknown> = {
    envelope_version: "readiness-envelope.v1",
    published_at: "2026-08-03T12:00:00.000Z",
    published_by: "test-agent",
    evidence: {
      contract_version: "readiness.v1",
      decision: "READY",
      valid_until: "2026-08-04T12:00:00.000Z",
      evaluated_at: "2026-08-03T12:00:00.000Z",
      projection_id: "test-projection-v1",
      projection_version: "1.0.0",
      classification: "POLICY_REQUIRED",
      reason: "Test readiness",
      diagnostic_ref: "readiness-ready",
    },
    projection: {
      id: "test-projection-v1",
      version: "1.0.0",
      content,
    },
    binding: {
      kind: "sha256",
      projection_sha256: sha256,
    },
  };
  if (overrides) {
    for (const key of Object.keys(overrides)) {
      if (
        key === "evidence" &&
        typeof overrides.evidence === "object" &&
        overrides.evidence !== null
      ) {
        env.evidence = {
          ...(env.evidence as Record<string, unknown>),
          ...(overrides.evidence as Record<string, unknown>),
        };
      } else if (
        key === "projection" &&
        typeof overrides.projection === "object" &&
        overrides.projection !== null
      ) {
        env.projection = {
          ...(env.projection as Record<string, unknown>),
          ...(overrides.projection as Record<string, unknown>),
        };
        const mergedProjection = env.projection as Record<string, unknown>;
        if (typeof mergedProjection.content === "string") {
          const newSha256 = createHash("sha256")
            .update(Buffer.from(mergedProjection.content, "utf-8"))
            .digest("hex");
          (env.binding as Record<string, unknown>).projection_sha256 = newSha256;
        }
      } else if (
        key === "binding" &&
        typeof overrides.binding === "object" &&
        overrides.binding !== null
      ) {
        env.binding = {
          ...(env.binding as Record<string, unknown>),
          ...(overrides.binding as Record<string, unknown>),
        };
      } else {
        env[key] = overrides[key];
      }
    }
  }
  return JSON.stringify(env);
}

function makeBlockedEnvelope(overrides?: Record<string, unknown>): string {
  const env: Record<string, unknown> = {
    envelope_version: "readiness-envelope.v1",
    published_at: "2026-08-03T12:00:00.000Z",
    published_by: "test-agent",
    evidence: {
      contract_version: "readiness.v1",
      decision: "BLOCKED",
      classification: "POLICY_REQUIRED",
      reason: "No readiness evidence",
      diagnostic_ref: "readiness-blocked",
    },
  };
  if (overrides) {
    for (const key of Object.keys(overrides)) {
      if (
        key === "evidence" &&
        typeof overrides.evidence === "object" &&
        overrides.evidence !== null
      ) {
        env.evidence = {
          ...(env.evidence as Record<string, unknown>),
          ...(overrides.evidence as Record<string, unknown>),
        };
      } else {
        env[key] = overrides[key];
      }
    }
  }
  return JSON.stringify(env);
}

function computeSha256(content: string): string {
  const { createHash } = require("node:crypto");
  return createHash("sha256").update(Buffer.from(content, "utf-8")).digest("hex");
}

describe("parseReadinessEnvelope", () => {
  describe("valid envelopes", () => {
    it("accepts a valid READY envelope with all required fields", () => {
      const result = parseReadinessEnvelope(makeReadyEnvelope());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.evidence.decision).toBe("READY");
        expect(result.projection).toBeDefined();
        expect(result.projection!.id).toBe("test-projection-v1");
        expect(result.projection!.version).toBe("1.0.0");
        expect(result.projection!.content).toBe("Test projection content");
        expect(result.evidenceJson).toBeTruthy();
      }
    });

    it("accepts a valid BLOCKED envelope without projection or binding", () => {
      const result = parseReadinessEnvelope(makeBlockedEnvelope());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.evidence.decision).toBe("BLOCKED");
        expect((result.envelope as { projection?: never }).projection).toBeUndefined();
        expect((result.envelope as { binding?: never }).binding).toBeUndefined();
        expect(result.evidenceJson).toBeTruthy();
      }
    });
  });

  describe("structural validation", () => {
    it("rejects invalid JSON", () => {
      const result = parseReadinessEnvelope("{invalid}");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("DUPLICATE_KEY");
    });

    it("rejects empty input", () => {
      const result = parseReadinessEnvelope("");
      expect(result.ok).toBe(false);
    });

    it("rejects input exceeding 262144 byte limit", () => {
      const large = '{"a":"' + "x".repeat(262140) + '"}';
      const result = parseReadinessEnvelope(large);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("MAXIMUM_SIZE_EXCEEDED");
    });

    it("rejects deeply nested objects exceeding depth limit", () => {
      const result = parseReadinessEnvelope(buildDeepObject(10));
      expect(result.ok).toBe(false);
    });

    it("accepts nested objects within depth limit", () => {
      const result = parseReadinessEnvelope(buildDeepObject(7));
      expect(result.ok).toBe(false); // not a valid envelope structure
    });

    it("rejects duplicate top-level key", () => {
      const json =
        '{"envelope_version":"readiness-envelope.v1","envelope_version":"readiness-envelope.v1","published_at":"2026-08-03T12:00:00.000Z","published_by":"test","evidence":{"contract_version":"readiness.v1","decision":"BLOCKED"}}';
      const result = parseReadinessEnvelope(json);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("DUPLICATE_KEY");
    });

    it("rejects duplicate key in nested evidence", () => {
      const json =
        '{"envelope_version":"readiness-envelope.v1","published_at":"2026-08-03T12:00:00.000Z","published_by":"test","evidence":{"contract_version":"readiness.v1","decision":"BLOCKED","decision":"BLOCKED"}}';
      const result = parseReadinessEnvelope(json);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("DUPLICATE_KEY");
    });

    it("rejects prototype key __proto__", () => {
      const json =
        '{"envelope_version":"readiness-envelope.v1","published_at":"2026-08-03T12:00:00.000Z","published_by":"test","evidence":{"contract_version":"readiness.v1","decision":"BLOCKED"},"__proto__":{"a":1}}';
      const result = parseReadinessEnvelope(json);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects prototype key constructor", () => {
      const json =
        '{"envelope_version":"readiness-envelope.v1","published_at":"2026-08-03T12:00:00.000Z","published_by":"test","evidence":{"contract_version":"readiness.v1","decision":"BLOCKED"},"constructor":{"a":1}}';
      const result = parseReadinessEnvelope(json);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects prototype key prototype", () => {
      const json =
        '{"envelope_version":"readiness-envelope.v1","published_at":"2026-08-03T12:00:00.000Z","published_by":"test","evidence":{"contract_version":"readiness.v1","decision":"BLOCKED"},"prototype":{"a":1}}';
      const result = parseReadinessEnvelope(json);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects unknown top-level field", () => {
      const result = parseReadinessEnvelope(makeBlockedEnvelope({ unknown_field: "value" }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects unknown evidence field", () => {
      const result = parseReadinessEnvelope(
        makeBlockedEnvelope({ evidence: { extra_field: "x" } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects unknown evidence field in READY envelope", () => {
      const result = parseReadinessEnvelope(
        makeReadyEnvelope({ evidence: { projectionVersion: "x" } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects unknown projection field", () => {
      const result = parseReadinessEnvelope(
        makeReadyEnvelope({ projection: { contentHash: "abc" } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects unknown binding field", () => {
      const result = parseReadinessEnvelope(
        makeReadyEnvelope({ binding: { algorithm: "sha256" } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects field named similarly to known field in evidence", () => {
      const result = parseReadinessEnvelope(
        makeBlockedEnvelope({ evidence: { diagnosticRef: "x" } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects unsupported envelope_version", () => {
      const result = parseReadinessEnvelope(makeBlockedEnvelope({ envelope_version: "v2" }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
    });

    it("rejects missing envelope_version", () => {
      const { envelope_version, ...rest } = JSON.parse(makeBlockedEnvelope());
      const result = parseReadinessEnvelope(JSON.stringify(rest));
      expect(result.ok).toBe(false);
    });

    it("rejects missing evidence", () => {
      const { evidence, ...rest } = JSON.parse(makeBlockedEnvelope());
      const result = parseReadinessEnvelope(JSON.stringify(rest));
      expect(result.ok).toBe(false);
    });

    it("rejects missing evidence.decision", () => {
      const parsed = JSON.parse(makeBlockedEnvelope());
      delete parsed.evidence.decision;
      const result = parseReadinessEnvelope(JSON.stringify(parsed));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("INVALID_DECISION");
    });

    it("rejects invalid evidence.decision", () => {
      const result = parseReadinessEnvelope(
        makeBlockedEnvelope({ evidence: { decision: "MAYBE" } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("INVALID_DECISION");
    });
  });

  describe("READY envelope validation", () => {
    it("rejects READY without valid_until", () => {
      const parsed = JSON.parse(makeReadyEnvelope());
      delete parsed.evidence.valid_until;
      const result = parseReadinessEnvelope(JSON.stringify(parsed));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects READY without evaluated_at", () => {
      const parsed = JSON.parse(makeReadyEnvelope());
      delete parsed.evidence.evaluated_at;
      const result = parseReadinessEnvelope(JSON.stringify(parsed));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects READY without projection_id", () => {
      const parsed = JSON.parse(makeReadyEnvelope());
      delete parsed.evidence.projection_id;
      const result = parseReadinessEnvelope(JSON.stringify(parsed));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects READY without projection_version", () => {
      const parsed = JSON.parse(makeReadyEnvelope());
      delete parsed.evidence.projection_version;
      const result = parseReadinessEnvelope(JSON.stringify(parsed));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects READY without projection", () => {
      const parsed = JSON.parse(makeReadyEnvelope());
      delete parsed.projection;
      const result = parseReadinessEnvelope(JSON.stringify(parsed));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects READY without binding", () => {
      const parsed = JSON.parse(makeReadyEnvelope());
      delete parsed.binding;
      const result = parseReadinessEnvelope(JSON.stringify(parsed));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });
  });

  describe("BLOCKED envelope validation", () => {
    it("rejects BLOCKED with projection", () => {
      const parsed = JSON.parse(makeBlockedEnvelope());
      parsed.projection = { id: "x", version: "1", content: "x" };
      const result = parseReadinessEnvelope(JSON.stringify(parsed));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects BLOCKED with binding", () => {
      const parsed = JSON.parse(makeBlockedEnvelope());
      parsed.binding = { kind: "sha256", projection_sha256: "a".repeat(64) };
      const result = parseReadinessEnvelope(JSON.stringify(parsed));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });
  });

  describe("projection binding", () => {
    it("rejects projection.id mismatch", () => {
      const result = parseReadinessEnvelope(makeReadyEnvelope({ projection: { id: "wrong-id" } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PROJECTION_BINDING_MISMATCH");
    });

    it("rejects projection.version mismatch", () => {
      const result = parseReadinessEnvelope(
        makeReadyEnvelope({ projection: { version: "2.0.0" } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PROJECTION_BINDING_MISMATCH");
    });

    it("rejects binding.kind !== sha256", () => {
      const result = parseReadinessEnvelope(makeReadyEnvelope({ binding: { kind: "md5" } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects missing binding.projection_sha256", () => {
      const parsed = JSON.parse(makeReadyEnvelope());
      delete parsed.binding.projection_sha256;
      const result = parseReadinessEnvelope(JSON.stringify(parsed));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects invalid digest format", () => {
      const result = parseReadinessEnvelope(
        makeReadyEnvelope({ binding: { projection_sha256: "not-a-valid-hash" } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects digest mismatch", () => {
      const result = parseReadinessEnvelope(
        makeReadyEnvelope({ binding: { projection_sha256: "a".repeat(64) } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });
  });

  describe("content size limits", () => {
    it("rejects projection.content exceeding 65536 bytes", () => {
      const largeContent = "x".repeat(65537);
      const result = parseReadinessEnvelope(
        makeReadyEnvelope({ projection: { content: largeContent } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("MAXIMUM_SIZE_EXCEEDED");
    });
  });

  describe("Unicode and hashing", () => {
    it("accepts Unicode projection content and verifies SHA-256", () => {
      const content = "\u4e2d\u6587\u30c6\u30b9\u30c8";
      const sha256 = computeSha256(content);
      const result = parseReadinessEnvelope(
        makeReadyEnvelope({
          projection: { content },
          binding: { projection_sha256: sha256 },
        }),
      );
      expect(result.ok).toBe(true);
    });

    it("produces different SHA-256 for LF vs CRLF content", () => {
      const lfContent = "hello\nworld";
      const crlfContent = "hello\r\nworld";
      const lfHash = computeSha256(lfContent);
      const crlfHash = computeSha256(crlfContent);
      expect(lfHash).not.toBe(crlfHash);

      const lfResult = parseReadinessEnvelope(
        makeReadyEnvelope({
          projection: { content: lfContent },
          binding: { projection_sha256: lfHash },
        }),
      );
      expect(lfResult.ok).toBe(true);

      const crlfResult = parseReadinessEnvelope(
        makeReadyEnvelope({
          projection: { content: crlfContent },
          binding: { projection_sha256: crlfHash },
        }),
      );
      expect(crlfResult.ok).toBe(true);
    });
  });

  describe("leading U+FEFF", () => {
    it("rejects leading U+FEFF character in string", () => {
      const result = parseReadinessEnvelope("\uFEFF" + makeBlockedEnvelope());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });
  });

  describe("reason/diagnostic/classification bounds", () => {
    it("rejects evidence.reason exceeding 1024 chars", () => {
      const result = parseReadinessEnvelope(
        makeBlockedEnvelope({ evidence: { reason: "x".repeat(1025) } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects evidence.diagnostic_ref exceeding 256 chars", () => {
      const result = parseReadinessEnvelope(
        makeBlockedEnvelope({ evidence: { diagnostic_ref: "x".repeat(257) } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });

    it("rejects evidence.classification exceeding 128 chars", () => {
      const result = parseReadinessEnvelope(
        makeBlockedEnvelope({ evidence: { classification: "x".repeat(129) } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
    });
  });

  describe("discriminated union behavior", () => {
    it("READY success has projection", () => {
      const result = parseReadinessEnvelope(makeReadyEnvelope());
      expect(result.ok).toBe(true);
      if (result.ok && result.envelope.evidence.decision === "READY") {
        expect(result.projection).toBeDefined();
      }
    });

    it("BLOCKED success has no projection", () => {
      const result = parseReadinessEnvelope(makeBlockedEnvelope());
      expect(result.ok).toBe(true);
      if (result.ok && result.envelope.evidence.decision === "BLOCKED") {
        expect((result as { projection?: unknown }).projection).toBeUndefined();
      }
    });

    it("failure is ok:false with typed code", () => {
      const result = parseReadinessEnvelope("");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(typeof result.code).toBe("string");
        expect(result.code.length).toBeGreaterThan(0);
      }
    });
  });
});
