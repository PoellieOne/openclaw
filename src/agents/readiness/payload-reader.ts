import { createHash } from "node:crypto";
import fs from "node:fs";
import { PAYLOAD_SCHEMA_VERSION } from "./contracts-v2.js";
import type { GeneratedSemanticPayloadV1 } from "./contracts-v2.js";
import { parseReadinessJson } from "./parser.js";

const MAX_PAYLOAD_BYTES = 65536;
const SHA256_HEX_LENGTH = 64;
const HEX_RE = /^[0-9a-f]+$/u;

const PAYLOAD_PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type PayloadReadSuccess = {
  ok: true;
  payload: GeneratedSemanticPayloadV1;
  payloadBytes: Uint8Array;
  sha256: string;
  bytecount: number;
};

export type PayloadReadError = {
  ok: false;
  code:
    | "PAYLOAD_MISSING"
    | "PAYLOAD_SYMLINK"
    | "PAYLOAD_NOT_REGULAR"
    | "PAYLOAD_TOO_LARGE"
    | "PAYLOAD_MALFORMED"
    | "PAYLOAD_SCHEMA_UNSUPPORTED"
    | "PAYLOAD_ID_MISMATCH"
    | "PAYLOAD_VERSION_MISMATCH"
    | "PAYLOAD_DIGEST_MISMATCH"
    | "PAYLOAD_BYTECOUNT_MISMATCH"
    | "SEMANTIC_PROJECTION_MISMATCH"
    | "SOURCE_MANIFEST_MISMATCH"
    | "INTERNAL_EVALUATION_FAILURE_SANITIZED";
  message: string;
};

export type PayloadReadResult = PayloadReadSuccess | PayloadReadError;

export type PayloadReadInput = {
  path: string;
  expectedPayloadId: string;
  expectedPayloadVersion: string;
  expectedSha256: string;
  expectedBytecount: number;
  expectedSemanticProjectionId: string;
  expectedSemanticProjectionVersion: string;
  expectedSemanticProjectionSourceDigest: string;
  expectedSourceManifestDigest: string;
};

type FsAdapter = {
  openSync: typeof fs.openSync;
  fstatSync: typeof fs.fstatSync;
  readSync: typeof fs.readSync;
  closeSync: typeof fs.closeSync;
  constants: typeof fs.constants;
};

const productionFs: FsAdapter = {
  openSync: fs.openSync,
  fstatSync: fs.fstatSync,
  readSync: fs.readSync,
  closeSync: fs.closeSync,
  constants: fs.constants,
};

let testFs: FsAdapter | undefined;

const TEST_FS_ADAPTER_KEY = Symbol.for("openclaw.payloadReaderTestFsAdapter");

function setTestFsAdapter(adapter: FsAdapter | undefined): void {
  testFs = adapter;
}

if (typeof process !== "undefined" && (process.env.VITEST || process.env.NODE_ENV === "test")) {
  (globalThis as Record<PropertyKey, unknown>)[TEST_FS_ADAPTER_KEY] = setTestFsAdapter;
}

function getFs(): FsAdapter {
  return testFs ?? productionFs;
}

function rejectLeadingBOM(
  buffer: Buffer,
): { ok: true } | { ok: false; code: PayloadReadError["code"]; message: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { ok: false, code: "PAYLOAD_MALFORMED", message: "UTF-8 BOM is not allowed" };
  }
  return { ok: true };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOwnProperty(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isHexSha256(value: unknown): value is string {
  return typeof value === "string" && value.length === SHA256_HEX_LENGTH && HEX_RE.test(value);
}

const PAYLOAD_TOP_LEVEL_FIELDS = new Set([
  "schema_version",
  "payload_id",
  "payload_version",
  "semantic_projection",
  "canonical_source_manifest",
  "canonical_identity",
  "continuity_anchor",
  "relationship_anchor",
  "active_presence",
  "internal_parent",
  "master_position_state",
  "formal_mission_state",
  "consequential_execution_policy",
  "authority_boundary",
  "external_migration_governance_separation",
  "provider_policy",
  "model_policy",
  "preferred_auth_method",
  "alternative_route_policy",
  "fallback_policy",
  "runtime_state_boundary",
  "workspace_boundary",
  "direct_spawn_authority_boundary",
  "canonical_publication_boundary",
  "security_boundary",
]);

const SEMANTIC_PROJECTION_FIELDS = new Set(["id", "version", "source_digest"]);
const SOURCE_MANIFEST_FIELDS = new Set(["manifest_id", "manifest_digest"]);

const TRANSIENT_FIELD_NAMES = [
  "decision",
  "evaluated_at",
  "valid_until",
  "session_id",
  "credential_route_status",
  "credential_route",
  "runtime_health",
];

function rejectTransientFields(obj: Record<string, unknown>): string | null {
  for (const key of TRANSIENT_FIELD_NAMES) {
    if (hasOwnProperty(obj, key)) return key;
  }
  return null;
}

function validateSemanticProjection(
  value: unknown,
  expectedId: string,
  expectedVersion: string,
  expectedSourceDigest: string,
): { ok: true } | { ok: false; code: PayloadReadError["code"]; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: "PAYLOAD_MALFORMED",
      message: "semantic_projection must be an object",
    };
  }
  for (const key of Object.keys(value)) {
    if (!SEMANTIC_PROJECTION_FIELDS.has(key)) {
      return {
        ok: false,
        code: "PAYLOAD_MALFORMED",
        message: `unknown semantic_projection field: ${key}`,
      };
    }
  }
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    return {
      ok: false,
      code: "PAYLOAD_MALFORMED",
      message: "semantic_projection.id must be a non-empty string",
    };
  }
  if (typeof value.version !== "string" || value.version.trim().length === 0) {
    return {
      ok: false,
      code: "PAYLOAD_MALFORMED",
      message: "semantic_projection.version must be a non-empty string",
    };
  }
  if (typeof value.source_digest !== "string" || !isHexSha256(value.source_digest)) {
    return {
      ok: false,
      code: "PAYLOAD_MALFORMED",
      message: "semantic_projection.source_digest must be a SHA-256 hex string",
    };
  }
  if (value.id !== expectedId) {
    return {
      ok: false,
      code: "SEMANTIC_PROJECTION_MISMATCH",
      message: "semantic projection id mismatch",
    };
  }
  if (value.version !== expectedVersion) {
    return {
      ok: false,
      code: "SEMANTIC_PROJECTION_MISMATCH",
      message: "semantic projection version mismatch",
    };
  }
  if (value.source_digest !== expectedSourceDigest) {
    return {
      ok: false,
      code: "SEMANTIC_PROJECTION_MISMATCH",
      message: "semantic projection source digest mismatch",
    };
  }
  return { ok: true };
}

function validateSourceManifest(
  value: unknown,
  expectedManifestDigest: string,
): { ok: true } | { ok: false; code: PayloadReadError["code"]; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: "PAYLOAD_MALFORMED",
      message: "canonical_source_manifest must be an object",
    };
  }
  for (const key of Object.keys(value)) {
    if (!SOURCE_MANIFEST_FIELDS.has(key)) {
      return {
        ok: false,
        code: "PAYLOAD_MALFORMED",
        message: `unknown canonical_source_manifest field: ${key}`,
      };
    }
  }
  if (typeof value.manifest_id !== "string" || value.manifest_id.trim().length === 0) {
    return {
      ok: false,
      code: "PAYLOAD_MALFORMED",
      message: "canonical_source_manifest.manifest_id must be a non-empty string",
    };
  }
  if (typeof value.manifest_digest !== "string" || !isHexSha256(value.manifest_digest)) {
    return {
      ok: false,
      code: "PAYLOAD_MALFORMED",
      message: "canonical_source_manifest.manifest_digest must be a SHA-256 hex string",
    };
  }
  if (value.manifest_digest !== expectedManifestDigest) {
    return {
      ok: false,
      code: "SOURCE_MANIFEST_MISMATCH",
      message: "source manifest digest mismatch",
    };
  }
  return { ok: true };
}

function validatePayloadSchema(
  value: unknown,
  input: PayloadReadInput,
):
  | { ok: true; payload: GeneratedSemanticPayloadV1 }
  | { ok: false; code: PayloadReadError["code"]; message: string } {
  if (!isPlainObject(value)) {
    return { ok: false, code: "PAYLOAD_MALFORMED", message: "payload must be a plain object" };
  }
  const obj = value as Record<string, unknown>;

  for (const key of PAYLOAD_PROTOTYPE_KEYS) {
    if (hasOwnProperty(obj, key)) {
      return { ok: false, code: "PAYLOAD_MALFORMED", message: `rejected key: ${key}` };
    }
  }

  for (const key of Object.keys(obj)) {
    if (!PAYLOAD_TOP_LEVEL_FIELDS.has(key)) {
      return { ok: false, code: "PAYLOAD_MALFORMED", message: `unknown payload field: ${key}` };
    }
  }

  const transientKey = rejectTransientFields(obj);
  if (transientKey !== null) {
    return {
      ok: false,
      code: "PAYLOAD_MALFORMED",
      message: `transient field not allowed in immutable payload: ${transientKey}`,
    };
  }

  if (obj.schema_version !== PAYLOAD_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "PAYLOAD_SCHEMA_UNSUPPORTED",
      message: `unsupported schema version: ${String(obj.schema_version)}`,
    };
  }

  if (typeof obj.payload_id !== "string" || obj.payload_id.trim().length === 0) {
    return {
      ok: false,
      code: "PAYLOAD_MALFORMED",
      message: "payload_id must be a non-empty string",
    };
  }
  if (typeof obj.payload_version !== "string" || obj.payload_version.trim().length === 0) {
    return {
      ok: false,
      code: "PAYLOAD_MALFORMED",
      message: "payload_version must be a non-empty string",
    };
  }

  for (const field of [
    "canonical_identity",
    "continuity_anchor",
    "relationship_anchor",
    "authority_boundary",
    "external_migration_governance_separation",
    "runtime_state_boundary",
    "workspace_boundary",
    "direct_spawn_authority_boundary",
    "canonical_publication_boundary",
    "security_boundary",
  ]) {
    if (typeof obj[field] !== "string" || (obj[field] as string).trim().length === 0) {
      return {
        ok: false,
        code: "PAYLOAD_MALFORMED",
        message: `${field} must be a non-empty string`,
      };
    }
  }

  const enumFields: Record<string, readonly string[]> = {
    active_presence: ["GENERAL_COLLABORATIVE_PRESENCE"],
    internal_parent: ["NOT_APPLICABLE"],
    master_position_state: ["NOT_ACTIVE_BY_DEFAULT"],
    formal_mission_state: ["NONE_UNLESS_ACTIVATED"],
    consequential_execution_policy: ["PROHIBITED_WITHOUT_GOVERNED_TRANSITION"],
    provider_policy: ["openai"],
    model_policy: ["openai/gpt-5.6-sol"],
    preferred_auth_method: ["OPENAI_CHATGPT_CODEX_OAUTH"],
    alternative_route_policy: ["DEEPSEEK_EXPLICIT_RALPH_SELECTION_ONLY"],
    fallback_policy: ["PROHIBITED"],
  };
  for (const [field, allowed] of Object.entries(enumFields)) {
    if (!allowed.includes(obj[field] as string)) {
      return { ok: false, code: "PAYLOAD_MALFORMED", message: `${field} has an unsupported value` };
    }
  }

  if (obj.payload_id !== input.expectedPayloadId) {
    return { ok: false, code: "PAYLOAD_ID_MISMATCH", message: "payload id mismatch" };
  }
  if (obj.payload_version !== input.expectedPayloadVersion) {
    return { ok: false, code: "PAYLOAD_VERSION_MISMATCH", message: "payload version mismatch" };
  }

  const semanticProjection = validateSemanticProjection(
    obj.semantic_projection,
    input.expectedSemanticProjectionId,
    input.expectedSemanticProjectionVersion,
    input.expectedSemanticProjectionSourceDigest,
  );
  if (!semanticProjection.ok) return semanticProjection;

  const sourceManifest = validateSourceManifest(
    obj.canonical_source_manifest,
    input.expectedSourceManifestDigest,
  );
  if (!sourceManifest.ok) return sourceManifest;

  return { ok: true, payload: value as unknown as GeneratedSemanticPayloadV1 };
}

export function loadGeneratedProjectionPayload(input: PayloadReadInput): PayloadReadResult {
  const f = getFs();

  if (typeof f.constants.O_NOFOLLOW !== "number") {
    return {
      ok: false,
      code: "INTERNAL_EVALUATION_FAILURE_SANITIZED",
      message: "platform does not support O_NOFOLLOW",
    };
  }

  let fd: number | undefined;
  try {
    fd = f.openSync(input.path, f.constants.O_RDONLY | f.constants.O_NOFOLLOW);
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ELOOP") {
      return { ok: false, code: "PAYLOAD_SYMLINK", message: "symlink not allowed" };
    }
    if (nodeErr.code === "ENOENT") {
      return { ok: false, code: "PAYLOAD_MISSING", message: "generated payload not found" };
    }
    return {
      ok: false,
      code: "INTERNAL_EVALUATION_FAILURE_SANITIZED",
      message: "failed to open generated payload",
    };
  }

  try {
    const before = f.fstatSync(fd);

    if (!before.isFile()) {
      return { ok: false, code: "PAYLOAD_NOT_REGULAR", message: "not a regular file" };
    }

    if (before.size > MAX_PAYLOAD_BYTES) {
      return { ok: false, code: "PAYLOAD_TOO_LARGE", message: "payload exceeds maximum size" };
    }

    if (before.size !== input.expectedBytecount) {
      return {
        ok: false,
        code: "PAYLOAD_BYTECOUNT_MISMATCH",
        message: "payload bytecount mismatch",
      };
    }

    const buffer = Buffer.alloc(before.size);
    let offset = 0;

    while (offset < buffer.length) {
      const count = f.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (count === 0) {
        return {
          ok: false,
          code: "INTERNAL_EVALUATION_FAILURE_SANITIZED",
          message: "payload read truncated",
        };
      }
      offset += count;
    }

    const after = f.fstatSync(fd);
    if (after.size !== before.size) {
      return {
        ok: false,
        code: "INTERNAL_EVALUATION_FAILURE_SANITIZED",
        message: "payload size changed during read",
      };
    }

    const bomResult = rejectLeadingBOM(buffer);
    if (!bomResult.ok) return bomResult;

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      return { ok: false, code: "PAYLOAD_MALFORMED", message: "invalid UTF-8 in payload" };
    }

    const parsed = parseReadinessJson(text);
    if (!parsed.ok) {
      if (parsed.code === "DUPLICATE_KEY") {
        return { ok: false, code: "PAYLOAD_MALFORMED", message: "duplicate key in payload" };
      }
      return { ok: false, code: "PAYLOAD_MALFORMED", message: "payload JSON parse failed" };
    }

    const validated = validatePayloadSchema(parsed.value, input);
    if (!validated.ok) return validated;

    const payloadBytes = new Uint8Array(buffer);
    const sha256 = computeSha256(payloadBytes);

    if (sha256 !== input.expectedSha256) {
      return { ok: false, code: "PAYLOAD_DIGEST_MISMATCH", message: "payload SHA-256 mismatch" };
    }

    return {
      ok: true,
      payload: validated.payload,
      payloadBytes,
      sha256,
      bytecount: payloadBytes.byteLength,
    };
  } finally {
    if (fd !== undefined) {
      try {
        f.closeSync(fd);
      } catch {
        // ignore close errors
      }
    }
  }
}

function computeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
