import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadGeneratedProjectionPayload } from "./payload-reader.js";
import type { PayloadReadInput } from "./payload-reader.js";

const TEST_FS_ADAPTER_KEY = Symbol.for("openclaw.payloadReaderTestFsAdapter");

function setTestFsAdapter(adapter: unknown): void {
  const fn = (globalThis as Record<PropertyKey, unknown>)[TEST_FS_ADAPTER_KEY];
  if (typeof fn === "function") {
    (fn as (adapter: unknown) => void)(adapter);
  }
}

const PAYLOAD_ID = "canonical-production-sophia-semantic-runtime-projection-v1";
const PAYLOAD_VERSION = "1.0.0";
const SOURCE_DIGEST = "b".repeat(64);
const MANIFEST_ID = "canonical-source-manifest.v1";
const MANIFEST_DIGEST = "d".repeat(64);

function makeValidPayloadJson(): string {
  return JSON.stringify({
    schema_version: "semantic-projection-payload.v1",
    payload_id: PAYLOAD_ID,
    payload_version: PAYLOAD_VERSION,
    semantic_projection: {
      id: PAYLOAD_ID,
      version: "1.0.1",
      source_digest: SOURCE_DIGEST,
    },
    canonical_source_manifest: {
      manifest_id: MANIFEST_ID,
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

function makeValidInput(overrides?: Partial<PayloadReadInput>): PayloadReadInput {
  const bytes = Buffer.from(makeValidPayloadJson(), "utf-8");
  return {
    path: "unused",
    expectedPayloadId: PAYLOAD_ID,
    expectedPayloadVersion: PAYLOAD_VERSION,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    expectedBytecount: bytes.byteLength,
    expectedSemanticProjectionId: PAYLOAD_ID,
    expectedSemanticProjectionVersion: "1.0.1",
    expectedSemanticProjectionSourceDigest: SOURCE_DIGEST,
    expectedSourceManifestDigest: MANIFEST_DIGEST,
    ...overrides,
  };
}

describe("loadGeneratedProjectionPayload", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "payload-reader-test-"));
    setTestFsAdapter(undefined);
  });

  afterEach(() => {
    setTestFsAdapter(undefined);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function writeFixture(json: string): { filePath: string; input: PayloadReadInput } {
    const filePath = path.join(tmpDir, "payload.json");
    fs.writeFileSync(filePath, json, "utf-8");
    const bytes = Buffer.from(json, "utf-8");
    const input = makeValidInput({
      path: filePath,
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
      expectedBytecount: bytes.byteLength,
    });
    return { filePath, input };
  }

  describe("with real filesystem", () => {
    it("accepts a valid exact payload and returns original bytes, sha256, bytecount", () => {
      const json = makeValidPayloadJson();
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.payload.payload_id).toBe(PAYLOAD_ID);
        expect(result.sha256).toBe(input.expectedSha256);
        expect(result.bytecount).toBe(input.expectedBytecount);
        expect(Buffer.from(result.payloadBytes).toString("utf-8")).toBe(json);
      }
    });

    it("returns PAYLOAD_MISSING when file does not exist", () => {
      const input = makeValidInput({ path: path.join(tmpDir, "missing.json") });
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_MISSING");
    });

    it("returns PAYLOAD_SYMLINK for a symlink", () => {
      const target = path.join(tmpDir, "target.json");
      fs.writeFileSync(target, makeValidPayloadJson(), "utf-8");
      const link = path.join(tmpDir, "link.json");
      fs.symlinkSync(target, link);
      const input = makeValidInput({
        path: link,
        expectedBytecount: Buffer.byteLength(makeValidPayloadJson(), "utf-8"),
        expectedSha256: createHash("sha256")
          .update(Buffer.from(makeValidPayloadJson(), "utf-8"))
          .digest("hex"),
      });
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_SYMLINK");
    });

    it("returns PAYLOAD_NOT_REGULAR for a directory", () => {
      const dirPath = path.join(tmpDir, "payload.json");
      fs.mkdirSync(dirPath);
      const input = makeValidInput({ path: dirPath });
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_NOT_REGULAR");
    });

    it("returns PAYLOAD_TOO_LARGE for oversized file", () => {
      const filePath = path.join(tmpDir, "payload.json");
      fs.writeFileSync(filePath, "x".repeat(65537), "utf-8");
      const input = makeValidInput({
        path: filePath,
        expectedBytecount: 65537,
        expectedSha256: createHash("sha256")
          .update(Buffer.from("x".repeat(65537)))
          .digest("hex"),
      });
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_TOO_LARGE");
    });

    it("returns PAYLOAD_BYTECOUNT_MISMATCH for wrong expected bytecount", () => {
      const json = makeValidPayloadJson();
      const { filePath, input } = writeFixture(json);
      const wrongInput = { ...input, expectedBytecount: input.expectedBytecount + 1 };
      const result = loadGeneratedProjectionPayload(wrongInput);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_BYTECOUNT_MISMATCH");
    });

    it("returns PAYLOAD_MALFORMED for leading UTF-8 BOM", () => {
      const filePath = path.join(tmpDir, "payload.json");
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const bytes = Buffer.concat([bom, Buffer.from(makeValidPayloadJson(), "utf-8")]);
      fs.writeFileSync(filePath, bytes);
      const input = makeValidInput({
        path: filePath,
        expectedBytecount: bytes.byteLength,
        expectedSha256: createHash("sha256").update(bytes).digest("hex"),
      });
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_MALFORMED");
    });

    it("returns PAYLOAD_MALFORMED for invalid UTF-8", () => {
      const filePath = path.join(tmpDir, "payload.json");
      const bytes = Buffer.from([0x80, 0x80, 0x80]);
      fs.writeFileSync(filePath, bytes);
      const input = makeValidInput({
        path: filePath,
        expectedBytecount: 3,
        expectedSha256: createHash("sha256").update(bytes).digest("hex"),
      });
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_MALFORMED");
    });

    it("returns PAYLOAD_MALFORMED for malformed JSON", () => {
      const json = makeValidPayloadJson().replace(/\}$/u, "");
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_MALFORMED");
    });

    it("returns PAYLOAD_MALFORMED for duplicate JSON key", () => {
      const json = makeValidPayloadJson().replace(
        /"payload_id":"[^"]*"/u,
        `"payload_id":"${PAYLOAD_ID}","payload_id":"${PAYLOAD_ID}"`,
      );
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_MALFORMED");
    });

    it("returns PAYLOAD_MALFORMED for unknown field", () => {
      const json = makeValidPayloadJson().replace(/\}$/u, ',"unexpected_field":1}');
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_MALFORMED");
    });

    it("returns PAYLOAD_MALFORMED for transient readiness fields in immutable payload", () => {
      const json = makeValidPayloadJson().replace(
        /\}$/u,
        ',"decision":"READY","evaluated_at":"2026-08-07T00:00:00.000Z"}',
      );
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_MALFORMED");
    });

    it("returns PAYLOAD_MALFORMED for transient credential-route fields", () => {
      const json = makeValidPayloadJson().replace(
        /\}$/u,
        ',"credential_route_status":"AVAILABLE_VERIFIED"}',
      );
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_MALFORMED");
    });

    it("returns PAYLOAD_MALFORMED for wrong field types", () => {
      const json = makeValidPayloadJson().replace(/"payload_id":"[^"]*"/u, '"payload_id":123');
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_MALFORMED");
    });

    it("returns PAYLOAD_SCHEMA_UNSUPPORTED for wrong schema version", () => {
      const json = makeValidPayloadJson().replace(
        /"schema_version":"[^"]*"/u,
        '"schema_version":"semantic-projection-payload.v2"',
      );
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_SCHEMA_UNSUPPORTED");
    });

    it("returns PAYLOAD_ID_MISMATCH for wrong payload id", () => {
      const json = makeValidPayloadJson();
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload({
        ...input,
        expectedPayloadId: "different-payload-id",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_ID_MISMATCH");
    });

    it("returns PAYLOAD_VERSION_MISMATCH for wrong payload version", () => {
      const json = makeValidPayloadJson();
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload({
        ...input,
        expectedPayloadVersion: "2.0.0",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_VERSION_MISMATCH");
    });

    it("returns PAYLOAD_DIGEST_MISMATCH for wrong SHA-256", () => {
      const json = makeValidPayloadJson();
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload({
        ...input,
        expectedSha256: "f".repeat(64),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_DIGEST_MISMATCH");
    });

    it("returns SEMANTIC_PROJECTION_MISMATCH for wrong semantic projection id", () => {
      const json = makeValidPayloadJson();
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload({
        ...input,
        expectedSemanticProjectionId: "different-projection-id",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("SEMANTIC_PROJECTION_MISMATCH");
    });

    it("returns SEMANTIC_PROJECTION_MISMATCH for wrong semantic projection version", () => {
      const json = makeValidPayloadJson();
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload({
        ...input,
        expectedSemanticProjectionVersion: "2.0.0",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("SEMANTIC_PROJECTION_MISMATCH");
    });

    it("returns SEMANTIC_PROJECTION_MISMATCH for wrong semantic projection source digest", () => {
      const json = makeValidPayloadJson();
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload({
        ...input,
        expectedSemanticProjectionSourceDigest: "f".repeat(64),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("SEMANTIC_PROJECTION_MISMATCH");
    });

    it("returns SOURCE_MANIFEST_MISMATCH for wrong manifest digest", () => {
      const json = makeValidPayloadJson();
      const { filePath, input } = writeFixture(json);
      const result = loadGeneratedProjectionPayload({
        ...input,
        expectedSourceManifestDigest: "e".repeat(64),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("SOURCE_MANIFEST_MISMATCH");
    });
  });

  describe("with test fs adapter", () => {
    it("returns INTERNAL_EVALUATION_FAILURE_SANITIZED when O_NOFOLLOW unavailable", () => {
      setTestFsAdapter({
        openSync: fs.openSync,
        fstatSync: fs.fstatSync,
        readSync: fs.readSync,
        closeSync: fs.closeSync,
        constants: { ...fs.constants, O_NOFOLLOW: undefined as unknown as number },
      });
      const result = loadGeneratedProjectionPayload(makeValidInput());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INTERNAL_EVALUATION_FAILURE_SANITIZED");
      }
    });

    it("returns PAYLOAD_SYMLINK for ELOOP", () => {
      setTestFsAdapter({
        openSync: () => {
          const e = new Error("symlink") as NodeJS.ErrnoException;
          e.code = "ELOOP";
          throw e;
        },
        fstatSync: fs.fstatSync,
        readSync: fs.readSync,
        closeSync: fs.closeSync,
        constants: fs.constants,
      });
      const result = loadGeneratedProjectionPayload(makeValidInput());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PAYLOAD_SYMLINK");
    });

    it("returns INTERNAL_EVALUATION_FAILURE_SANITIZED for EACCES", () => {
      setTestFsAdapter({
        openSync: () => {
          const e = new Error("permission denied") as NodeJS.ErrnoException;
          e.code = "EACCES";
          throw e;
        },
        fstatSync: fs.fstatSync,
        readSync: fs.readSync,
        closeSync: fs.closeSync,
        constants: fs.constants,
      });
      const result = loadGeneratedProjectionPayload(makeValidInput());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INTERNAL_EVALUATION_FAILURE_SANITIZED");
      }
    });

    it("returns INTERNAL_EVALUATION_FAILURE_SANITIZED for file shrink during read", () => {
      const json = makeValidPayloadJson();
      const buf = Buffer.from(json, "utf-8");
      let fstatCallCount = 0;
      setTestFsAdapter({
        openSync: () => 3,
        fstatSync: () => {
          fstatCallCount++;
          return { isFile: () => true, size: fstatCallCount === 1 ? buf.length : buf.length - 1 };
        },
        readSync: (
          _fd: number,
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          const end = Math.min(position + length, buf.length);
          const bytesToCopy = end - position;
          buf.copy(buffer, offset, position, end);
          return bytesToCopy;
        },
        closeSync: () => {},
        constants: fs.constants,
      });
      const input = makeValidInput({
        expectedBytecount: buf.length,
        expectedSha256: createHash("sha256").update(buf).digest("hex"),
      });
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INTERNAL_EVALUATION_FAILURE_SANITIZED");
      }
    });

    it("closes descriptor after success", () => {
      const json = makeValidPayloadJson();
      const buf = Buffer.from(json, "utf-8");
      let closed = false;
      setTestFsAdapter({
        openSync: () => 3,
        fstatSync: () => ({ isFile: () => true, size: buf.length }),
        readSync: (
          _fd: number,
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          const end = Math.min(position + length, buf.length);
          const bytesToCopy = end - position;
          buf.copy(buffer, offset, position, end);
          return bytesToCopy;
        },
        closeSync: () => {
          closed = true;
        },
        constants: fs.constants,
      });
      const input = makeValidInput({
        expectedBytecount: buf.length,
        expectedSha256: createHash("sha256").update(buf).digest("hex"),
      });
      const result = loadGeneratedProjectionPayload(input);
      expect(result.ok).toBe(true);
      expect(closed).toBe(true);
    });
  });
});
