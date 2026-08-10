import { createHash } from "node:crypto";
import { ReadinessCode } from "./codes.js";
import { CONTRACT_VERSION_V2, ENVELOPE_VERSION_V2, MANIFEST_ID } from "./contracts-v2.js";
import type { GovernedReadinessProjection } from "./types.js";

const MAX_ENVELOPE_BYTES = 262144;
const MAX_DEPTH = 8;
const MAX_PROJECTION_CONTENT_BYTES = 65536;
const MAX_REASON_LENGTH = 1024;
const MAX_DIAGNOSTIC_REF_LENGTH = 256;
const MAX_CLASSIFICATION_LENGTH = 128;
const SUPPORTED_ENVELOPE_VERSION = "readiness-envelope.v1";
const SUPPORTED_CONTRACT_VERSION = "readiness.v1";
const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type CanonicalReadinessBinding = {
  kind: "sha256";
  projectionSha256: string;
};

export type ReadyCanonicalReadinessEnvelope = {
  envelopeVersion: "readiness-envelope.v1";
  publishedAt: string;
  publishedBy: string;
  evidence: {
    contract_version: "readiness.v1";
    decision: "READY";
    valid_until: string;
    classification?: string;
    reason?: string;
    diagnostic_ref?: string;
    evaluated_at: string;
    projection_id: string;
    projection_version: string;
  };
  projection: GovernedReadinessProjection;
  binding: CanonicalReadinessBinding;
};

export type BlockedCanonicalReadinessEnvelope = {
  envelopeVersion: "readiness-envelope.v1";
  publishedAt: string;
  publishedBy: string;
  evidence: {
    contract_version: "readiness.v1";
    decision: "BLOCKED";
    classification?: string;
    reason?: string;
    diagnostic_ref?: string;
  };
  projection?: never;
  binding?: never;
};

export type CanonicalReadinessEnvelope =
  | ReadyCanonicalReadinessEnvelope
  | BlockedCanonicalReadinessEnvelope;

export type CanonicalReadinessEnvelopeLoadResult =
  | {
      ok: true;
      envelope: ReadyCanonicalReadinessEnvelope;
      evidenceJson: string;
      projection: GovernedReadinessProjection;
    }
  | {
      ok: true;
      envelope: BlockedCanonicalReadinessEnvelope;
      evidenceJson: string;
      projection?: never;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type ParseState = {
  input: string;
  chars: string[];
  len: number;
  pos: number;
};

function isWhitespace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function skipWhitespace(st: ParseState): void {
  while (st.pos < st.len && isWhitespace(st.chars[st.pos]!.charCodeAt(0))) {
    st.pos++;
  }
}

function peek(st: ParseState): string | null {
  skipWhitespace(st);
  return st.pos < st.len ? st.chars[st.pos]! : null;
}

function expect(st: ParseState, c: string): boolean {
  skipWhitespace(st);
  if (st.pos < st.len && st.chars[st.pos] === c) {
    st.pos++;
    return true;
  }
  return false;
}

function parseString(st: ParseState): string | null {
  if (peek(st) !== '"') return null;
  st.pos++;
  let result = "";
  while (st.pos < st.len) {
    const ch = st.chars[st.pos];
    if (ch === '"') {
      st.pos++;
      return result;
    }
    if (ch === "\\") {
      st.pos++;
      if (st.pos >= st.len) return null;
      const esc = st.chars[st.pos];
      if (esc === "u") {
        if (st.pos + 4 >= st.len) return null;
        const hex = st.chars.slice(st.pos + 1, st.pos + 5).join("");
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
        result += String.fromCharCode(parseInt(hex, 16));
        st.pos += 5;
      } else {
        result += esc;
        st.pos++;
      }
    } else if (ch === "\n" || ch === "\r") {
      return null;
    } else {
      result += ch;
      st.pos++;
    }
  }
  return null;
}

function scanValue(st: ParseState, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  const c = peek(st);
  if (c === null) return false;
  if (c === '"') return parseString(st) !== null;
  if (c === "{") return scanObject(st, depth);
  if (c === "[") return scanArray(st, depth);
  if (c === "-" || (c >= "0" && c <= "9")) return scanNumber(st);
  if (c === "t" || c === "f" || c === "n") return scanKeyword(st);
  return false;
}

function scanNumber(st: ParseState): boolean {
  if (st.pos < st.len && st.chars[st.pos]! === "-") st.pos++;
  if (st.pos >= st.len || st.chars[st.pos]! < "0" || st.chars[st.pos]! > "9") return false;
  while (st.pos < st.len && st.chars[st.pos]! >= "0" && st.chars[st.pos]! <= "9") st.pos++;
  if (st.pos < st.len && st.chars[st.pos]! === ".") {
    st.pos++;
    if (st.pos >= st.len || st.chars[st.pos]! < "0" || st.chars[st.pos]! > "9") return false;
    while (st.pos < st.len && st.chars[st.pos]! >= "0" && st.chars[st.pos]! <= "9") st.pos++;
  }
  if (st.pos < st.len && (st.chars[st.pos]! === "e" || st.chars[st.pos]! === "E")) {
    st.pos++;
    if (st.pos < st.len && (st.chars[st.pos]! === "+" || st.chars[st.pos]! === "-")) st.pos++;
    if (st.pos >= st.len || st.chars[st.pos]! < "0" || st.chars[st.pos]! > "9") return false;
    while (st.pos < st.len && st.chars[st.pos]! >= "0" && st.chars[st.pos]! <= "9") st.pos++;
  }
  return true;
}

function scanKeyword(st: ParseState): boolean {
  if (
    st.pos + 4 <= st.len &&
    st.chars[st.pos] === "t" &&
    st.chars[st.pos + 1] === "r" &&
    st.chars[st.pos + 2] === "u" &&
    st.chars[st.pos + 3] === "e"
  ) {
    st.pos += 4;
    return true;
  }
  if (
    st.pos + 5 <= st.len &&
    st.chars[st.pos] === "f" &&
    st.chars[st.pos + 1] === "a" &&
    st.chars[st.pos + 2] === "l" &&
    st.chars[st.pos + 3] === "s" &&
    st.chars[st.pos + 4] === "e"
  ) {
    st.pos += 5;
    return true;
  }
  if (
    st.pos + 4 <= st.len &&
    st.chars[st.pos] === "n" &&
    st.chars[st.pos + 1] === "u" &&
    st.chars[st.pos + 2] === "l" &&
    st.chars[st.pos + 3] === "l"
  ) {
    st.pos += 4;
    return true;
  }
  return false;
}

function scanObject(st: ParseState, depth: number): boolean {
  if (peek(st) !== "{") return false;
  st.pos++;
  const seenKeys = new Set<string>();
  let first = true;
  while (true) {
    skipWhitespace(st);
    if (peek(st) === "}") {
      st.pos++;
      return true;
    }
    if (!first) {
      if (!expect(st, ",")) return false;
      skipWhitespace(st);
      if (peek(st) === "}") return false;
    }
    first = false;
    const key = parseString(st);
    if (key === null) return false;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    if (!expect(st, ":")) return false;
    if (!scanValue(st, depth + 1)) return false;
  }
}

function scanArray(st: ParseState, depth: number): boolean {
  if (peek(st) !== "[") return false;
  st.pos++;
  let first = true;
  while (true) {
    skipWhitespace(st);
    if (peek(st) === "]") {
      st.pos++;
      return true;
    }
    if (!first) {
      if (!expect(st, ",")) return false;
      skipWhitespace(st);
      if (peek(st) === "]") return false;
    }
    first = false;
    if (!scanValue(st, depth + 1)) return false;
  }
}

function strictParse(
  input: string,
): { ok: true; value: unknown } | { ok: false; code: string; message: string } {
  if (new TextEncoder().encode(input).length > MAX_ENVELOPE_BYTES) {
    return {
      ok: false,
      code: ReadinessCode.MAXIMUM_SIZE_EXCEEDED,
      message: "envelope exceeds maximum size",
    };
  }

  const st: ParseState = {
    input,
    chars: [...input],
    len: input.length,
    pos: 0,
  };

  skipWhitespace(st);
  if (st.pos >= st.len) {
    return { ok: false, code: ReadinessCode.EVIDENCE_MALFORMED, message: "empty input" };
  }

  if (peek(st) !== "{") {
    return { ok: false, code: ReadinessCode.EVIDENCE_MALFORMED, message: "root must be an object" };
  }

  if (!scanObject(st, 0)) {
    return {
      ok: false,
      code: ReadinessCode.DUPLICATE_KEY,
      message: "duplicate key or malformed structure",
    };
  }

  skipWhitespace(st);
  if (st.pos !== st.len) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "trailing content after root",
    };
  }

  try {
    const value = JSON.parse(input);
    return { ok: true, value };
  } catch {
    return { ok: false, code: ReadinessCode.EVIDENCE_MALFORMED, message: "JSON parse failed" };
  }
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

function isValidIsoTimestamp(s: string): boolean {
  const d = new Date(s);
  if (isNaN(d.getTime())) return false;
  return d.toISOString() === s || s.endsWith("Z") || s.includes("+") || s.includes("T");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHexSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function rejectPrototypeKeys(obj: Record<string, unknown>): string | null {
  for (const key of PROTOTYPE_KEYS) {
    if (hasOwnProperty(obj, key)) {
      return key;
    }
  }
  return null;
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): { ok: false; code: string; message: string } | null {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: `unknown ${label} field: ${key}`,
      };
    }
  }
  return null;
}

function checkStringBounds(value: unknown, maxLen: number): boolean {
  return typeof value === "string" && value.length <= maxLen;
}

const ALLOWED_EVIDENCE_KEYS = new Set([
  "contract_version",
  "decision",
  "valid_until",
  "classification",
  "reason",
  "diagnostic_ref",
  "evaluated_at",
  "projection_id",
  "projection_version",
]);

const ALLOWED_PROJECTION_KEYS = new Set(["id", "version", "content"]);

const ALLOWED_BINDING_KEYS = new Set(["kind", "projection_sha256"]);

function validateEnvelopeStructure(
  parsed: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string } {
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "envelope must be a plain object",
    };
  }

  const obj = parsed as Record<string, unknown>;

  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected key: ${protoKey}`,
    };
  }

  const allowedTopLevel = new Set([
    "envelope_version",
    "published_at",
    "published_by",
    "evidence",
    "projection",
    "binding",
  ]);
  for (const key of Object.keys(obj)) {
    if (!allowedTopLevel.has(key)) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: `unknown field: ${key}`,
      };
    }
  }

  if (obj.envelope_version !== SUPPORTED_ENVELOPE_VERSION) {
    return {
      ok: false,
      code: ReadinessCode.UNSUPPORTED_CONTRACT_VERSION,
      message: `unsupported envelope version: ${String(obj.envelope_version)}`,
    };
  }

  if (!isNonEmptyString(obj.published_at)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "published_at must be a non-empty string",
    };
  }
  if (!isValidIsoTimestamp(obj.published_at)) {
    return {
      ok: false,
      code: ReadinessCode.INVALID_TIMESTAMP,
      message: "published_at is not a valid ISO 8601 timestamp",
    };
  }

  if (!isNonEmptyString(obj.published_by)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "published_by must be a non-empty string",
    };
  }

  if (!isPlainObject(obj.evidence)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "evidence must be a plain object",
    };
  }

  return { ok: true, value: obj };
}

function validateEvidence(
  evidence: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string } {
  const protoKey = rejectPrototypeKeys(evidence);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected evidence key: ${protoKey}`,
    };
  }

  const unknownErr = rejectUnknownKeys(evidence, ALLOWED_EVIDENCE_KEYS, "evidence");
  if (unknownErr) return unknownErr;

  if (evidence.contract_version !== SUPPORTED_CONTRACT_VERSION) {
    return {
      ok: false,
      code: ReadinessCode.UNSUPPORTED_CONTRACT_VERSION,
      message: `unsupported contract version: ${String(evidence.contract_version)}`,
    };
  }

  if (evidence.decision !== "READY" && evidence.decision !== "BLOCKED") {
    return {
      ok: false,
      code: ReadinessCode.INVALID_DECISION,
      message: `invalid decision: ${String(evidence.decision)}`,
    };
  }

  if (evidence.classification !== undefined) {
    if (
      !isNonEmptyString(evidence.classification) ||
      !checkStringBounds(evidence.classification, MAX_CLASSIFICATION_LENGTH)
    ) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "classification must be a non-empty string within length limit",
      };
    }
  }

  if (evidence.reason !== undefined) {
    if (!checkStringBounds(evidence.reason, MAX_REASON_LENGTH)) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "reason exceeds maximum length",
      };
    }
  }

  if (evidence.diagnostic_ref !== undefined) {
    if (
      !isNonEmptyString(evidence.diagnostic_ref) ||
      !checkStringBounds(evidence.diagnostic_ref, MAX_DIAGNOSTIC_REF_LENGTH)
    ) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "diagnostic_ref must be a non-empty string within length limit",
      };
    }
  }

  return { ok: true, value: evidence };
}

function validateReadyEvidence(
  evidence: Record<string, unknown>,
): { ok: true } | { ok: false; code: string; message: string } {
  if (!isNonEmptyString(evidence.valid_until)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "READY evidence requires valid_until",
    };
  }
  if (!isValidIsoTimestamp(evidence.valid_until)) {
    return {
      ok: false,
      code: ReadinessCode.INVALID_TIMESTAMP,
      message: "valid_until is not a valid ISO 8601 timestamp",
    };
  }

  if (!isNonEmptyString(evidence.evaluated_at)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "READY evidence requires evaluated_at",
    };
  }
  if (!isValidIsoTimestamp(evidence.evaluated_at)) {
    return {
      ok: false,
      code: ReadinessCode.INVALID_TIMESTAMP,
      message: "evaluated_at is not a valid ISO 8601 timestamp",
    };
  }

  if (!isNonEmptyString(evidence.projection_id)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "READY evidence requires projection_id",
    };
  }

  if (!isNonEmptyString(evidence.projection_version)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "READY evidence requires projection_version",
    };
  }

  return { ok: true };
}

function validateProjection(
  projection: unknown,
  expectedId: string,
  expectedVersion: string,
):
  | { ok: true; projection: GovernedReadinessProjection }
  | { ok: false; code: string; message: string } {
  if (!isPlainObject(projection)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "projection must be a plain object",
    };
  }

  const obj = projection as Record<string, unknown>;

  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected projection key: ${protoKey}`,
    };
  }

  const unknownErr = rejectUnknownKeys(obj, ALLOWED_PROJECTION_KEYS, "projection");
  if (unknownErr) return unknownErr;

  if (!isNonEmptyString(obj.id)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "projection.id must be a non-empty string",
    };
  }

  if (!isNonEmptyString(obj.version)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "projection.version must be a non-empty string",
    };
  }

  if (obj.id !== expectedId) {
    return {
      ok: false,
      code: ReadinessCode.PROJECTION_BINDING_MISMATCH,
      message: `projection.id mismatch: expected ${expectedId}, got ${String(obj.id)}`,
    };
  }

  if (obj.version !== expectedVersion) {
    return {
      ok: false,
      code: ReadinessCode.PROJECTION_BINDING_MISMATCH,
      message: `projection.version mismatch: expected ${expectedVersion}, got ${String(obj.version)}`,
    };
  }

  if (typeof obj.content !== "string") {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "projection.content must be a string",
    };
  }

  if (new TextEncoder().encode(obj.content).length > MAX_PROJECTION_CONTENT_BYTES) {
    return {
      ok: false,
      code: ReadinessCode.MAXIMUM_SIZE_EXCEEDED,
      message: "projection.content exceeds maximum size",
    };
  }

  return {
    ok: true,
    projection: {
      id: obj.id,
      version: obj.version,
      content: obj.content,
    },
  };
}

function validateBinding(
  binding: unknown,
  projectionContent: string,
): { ok: true; binding: CanonicalReadinessBinding } | { ok: false; code: string; message: string } {
  if (!isPlainObject(binding)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "binding must be a plain object",
    };
  }

  const obj = binding as Record<string, unknown>;

  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected binding key: ${protoKey}`,
    };
  }

  const unknownErr = rejectUnknownKeys(obj, ALLOWED_BINDING_KEYS, "binding");
  if (unknownErr) return unknownErr;

  if (obj.kind !== "sha256") {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "binding.kind must be 'sha256'",
    };
  }

  if (!isHexSha256(obj.projection_sha256)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "binding.projection_sha256 must be a 64-character hex string",
    };
  }

  const actualDigest = createHash("sha256")
    .update(Buffer.from(projectionContent, "utf-8"))
    .digest("hex");

  if (actualDigest !== obj.projection_sha256) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "projection content hash mismatch",
    };
  }

  return { ok: true, binding: { kind: "sha256", projectionSha256: obj.projection_sha256 } };
}

export function parseReadinessEnvelope(input: string): CanonicalReadinessEnvelopeLoadResult {
  const parseResult = strictParse(input);
  if (!parseResult.ok) {
    return { ok: false, code: parseResult.code, message: parseResult.message };
  }

  const structureResult = validateEnvelopeStructure(parseResult.value);
  if (!structureResult.ok) {
    return structureResult;
  }

  const obj = structureResult.value;
  const evidence = obj.evidence as Record<string, unknown>;

  const evidenceResult = validateEvidence(evidence);
  if (!evidenceResult.ok) {
    return evidenceResult;
  }

  const evidenceJson = JSON.stringify(evidence);

  if (evidence.decision === "BLOCKED") {
    if (obj.projection !== undefined) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "BLOCKED envelope must not contain projection",
      };
    }
    if (obj.binding !== undefined) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "BLOCKED envelope must not contain binding",
      };
    }

    const blockedEnvelope: BlockedCanonicalReadinessEnvelope = {
      envelopeVersion: "readiness-envelope.v1",
      publishedAt: obj.published_at as string,
      publishedBy: obj.published_by as string,
      evidence: {
        contract_version: "readiness.v1",
        decision: "BLOCKED",
        classification: isNonEmptyString(evidence.classification)
          ? evidence.classification
          : undefined,
        reason: typeof evidence.reason === "string" ? evidence.reason : undefined,
        diagnostic_ref: isNonEmptyString(evidence.diagnostic_ref)
          ? evidence.diagnostic_ref
          : undefined,
      },
    };

    return { ok: true, envelope: blockedEnvelope, evidenceJson };
  }

  const readyEvidenceResult = validateReadyEvidence(evidence);
  if (!readyEvidenceResult.ok) {
    return readyEvidenceResult;
  }

  const projectionResult = validateProjection(
    obj.projection,
    evidence.projection_id as string,
    evidence.projection_version as string,
  );
  if (!projectionResult.ok) {
    return projectionResult;
  }

  const bindingResult = validateBinding(obj.binding, projectionResult.projection.content);
  if (!bindingResult.ok) {
    return bindingResult;
  }

  const readyEnvelope: ReadyCanonicalReadinessEnvelope = {
    envelopeVersion: "readiness-envelope.v1",
    publishedAt: obj.published_at as string,
    publishedBy: obj.published_by as string,
    evidence: {
      contract_version: "readiness.v1",
      decision: "READY",
      valid_until: evidence.valid_until as string,
      classification: isNonEmptyString(evidence.classification)
        ? evidence.classification
        : undefined,
      reason: typeof evidence.reason === "string" ? evidence.reason : undefined,
      diagnostic_ref: isNonEmptyString(evidence.diagnostic_ref)
        ? evidence.diagnostic_ref
        : undefined,
      evaluated_at: evidence.evaluated_at as string,
      projection_id: evidence.projection_id as string,
      projection_version: evidence.projection_version as string,
    },
    projection: projectionResult.projection,
    binding: bindingResult.binding,
  };

  return {
    ok: true,
    envelope: readyEnvelope,
    evidenceJson,
    projection: projectionResult.projection,
  };
}

export type ReadyV2CanonicalReadinessEnvelope = {
  envelopeVersion: "readiness-envelope.v2";
  publishedAt: string;
  publishedBy: string;
  evidence: {
    contract_version: "readiness.v2";
    decision: "READY";
    valid_until: string;
    classification?: string;
    reason?: string;
    diagnostic_ref?: string;
    evaluated_at: string;
  };
  projection: GovernedReadinessProjection;
  binding: CanonicalReadinessBinding;
  semanticProjection: {
    id: string;
    version: string;
    sourceDigest: string;
  };
  generatedPayload: {
    payloadId: string;
    payloadVersion: string;
    payloadSha256: string;
    payloadBytecount: number;
    payloadFilename: string;
  };
  sourceManifest: {
    manifestId: string;
    manifestDigest: string;
  };
  agentBinding: { agentId: string };
  runtimeBinding: { imageId: string; sourceCommit: string; sourceTree: string };
  configBinding: { configDigest: string };
  policyBinding: {
    providerPolicy: string;
    modelPolicy: string;
    preferredAuthMethod: string;
    fallbackPolicy: string;
  };
  credentialRoute: { authMethodPolicy: string; credentialRouteStatus: string };
  validator: { validatorId: string; validatorVersion: string };
  revalidation: { revalidationRequired: boolean; reason: string | null; validatorVersion: string };
  provenance: { generatorId: string; generatorVersion: string };
};

export type BlockedV2CanonicalReadinessEnvelope = {
  envelopeVersion: "readiness-envelope.v2";
  publishedAt: string;
  publishedBy: string;
  evidence: {
    contract_version: "readiness.v2";
    decision: "BLOCKED";
    classification?: string;
    reason?: string;
    diagnostic_ref?: string;
  };
  projection?: never;
  binding?: never;
};

export type V2CanonicalReadinessEnvelope =
  | ReadyV2CanonicalReadinessEnvelope
  | BlockedV2CanonicalReadinessEnvelope;

export type V2CanonicalReadinessEnvelopeLoadResult =
  | {
      ok: true;
      envelope: ReadyV2CanonicalReadinessEnvelope;
      envelopeJson: string;
      projection: GovernedReadinessProjection;
    }
  | {
      ok: true;
      envelope: BlockedV2CanonicalReadinessEnvelope;
      envelopeJson: string;
      projection?: never;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

const V2_TOP_LEVEL_KEYS = new Set([
  "envelope_version",
  "published_at",
  "published_by",
  "evidence",
  "projection",
  "binding",
  "semantic_projection",
  "generated_payload",
  "source_manifest",
  "agent_binding",
  "runtime_binding",
  "config_binding",
  "policy_binding",
  "credential_route",
  "validator",
  "revalidation",
  "provenance",
]);

const V2_EVIDENCE_KEYS = new Set([
  "contract_version",
  "decision",
  "valid_until",
  "classification",
  "reason",
  "diagnostic_ref",
  "evaluated_at",
]);

const V2_SEMANTIC_PROJECTION_KEYS = new Set(["id", "version", "source_digest"]);
const V2_GENERATED_PAYLOAD_KEYS = new Set([
  "payload_id",
  "payload_version",
  "payload_sha256",
  "payload_bytecount",
  "payload_filename",
]);
const V2_SOURCE_MANIFEST_KEYS = new Set(["manifest_id", "manifest_digest"]);
const V2_AGENT_BINDING_KEYS = new Set(["agent_id"]);
const V2_RUNTIME_BINDING_KEYS = new Set(["image_id", "source_commit", "source_tree"]);
const V2_CONFIG_BINDING_KEYS = new Set(["config_digest"]);
const V2_POLICY_BINDING_KEYS = new Set([
  "provider_policy",
  "model_policy",
  "preferred_auth_method",
  "fallback_policy",
]);
const V2_CREDENTIAL_ROUTE_KEYS = new Set(["auth_method_policy", "credential_route_status"]);
const V2_VALIDATOR_KEYS = new Set(["validator_id", "validator_version"]);
const V2_REVALIDATION_KEYS = new Set(["revalidation_required", "reason", "validator_version"]);
const V2_PROVENANCE_KEYS = new Set(["generator_id", "generator_version"]);

const CREDENTIAL_ROUTE_STATUSES = new Set([
  "NOT_MATERIALIZED",
  "NOT_VERIFIED",
  "AVAILABLE_VERIFIED",
  "UNAVAILABLE",
  "BLOCKED",
]);

function validateV2EvidenceStructure(
  evidence: Record<string, unknown>,
): { ok: true } | { ok: false; code: string; message: string } {
  const protoKey = rejectPrototypeKeys(evidence);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected evidence key: ${protoKey}`,
    };
  }
  const unknownErr = rejectUnknownKeys(evidence, V2_EVIDENCE_KEYS, "evidence");
  if (unknownErr) return unknownErr;
  if (evidence.contract_version !== CONTRACT_VERSION_V2) {
    return {
      ok: false,
      code: ReadinessCode.UNSUPPORTED_CONTRACT_VERSION,
      message: `unsupported contract version: ${String(evidence.contract_version)}`,
    };
  }
  if (evidence.decision !== "READY" && evidence.decision !== "BLOCKED") {
    return {
      ok: false,
      code: ReadinessCode.INVALID_DECISION,
      message: `invalid decision: ${String(evidence.decision)}`,
    };
  }
  if (evidence.classification !== undefined) {
    if (
      !isNonEmptyString(evidence.classification) ||
      !checkStringBounds(evidence.classification, MAX_CLASSIFICATION_LENGTH)
    ) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "classification must be a non-empty string within length limit",
      };
    }
  }
  if (evidence.reason !== undefined && !checkStringBounds(evidence.reason, MAX_REASON_LENGTH)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "reason exceeds maximum length",
    };
  }
  if (evidence.diagnostic_ref !== undefined) {
    if (
      !isNonEmptyString(evidence.diagnostic_ref) ||
      !checkStringBounds(evidence.diagnostic_ref, MAX_DIAGNOSTIC_REF_LENGTH)
    ) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "diagnostic_ref must be a non-empty string within length limit",
      };
    }
  }
  return { ok: true };
}

function validateV2ReadyEvidence(
  evidence: Record<string, unknown>,
): { ok: true } | { ok: false; code: string; message: string } {
  if (!isNonEmptyString(evidence.valid_until) || !isValidIsoTimestamp(evidence.valid_until)) {
    return {
      ok: false,
      code: ReadinessCode.INVALID_TIMESTAMP,
      message: "READY evidence requires a valid valid_until",
    };
  }
  if (!isNonEmptyString(evidence.evaluated_at) || !isValidIsoTimestamp(evidence.evaluated_at)) {
    return {
      ok: false,
      code: ReadinessCode.INVALID_TIMESTAMP,
      message: "READY evidence requires a valid evaluated_at",
    };
  }
  return { ok: true };
}

function validateV2ProjectionStructure(
  projection: unknown,
):
  | { ok: true; projection: GovernedReadinessProjection }
  | { ok: false; code: string; message: string } {
  if (!isPlainObject(projection)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "projection must be a plain object",
    };
  }
  const obj = projection as Record<string, unknown>;
  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected projection key: ${protoKey}`,
    };
  }
  const unknownErr = rejectUnknownKeys(obj, ALLOWED_PROJECTION_KEYS, "projection");
  if (unknownErr) return unknownErr;
  if (!isNonEmptyString(obj.id) || !isNonEmptyString(obj.version)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "projection.id/version must be non-empty strings",
    };
  }
  if (typeof obj.content !== "string") {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "projection.content must be a string",
    };
  }
  if (new TextEncoder().encode(obj.content).length > MAX_PROJECTION_CONTENT_BYTES) {
    return {
      ok: false,
      code: ReadinessCode.MAXIMUM_SIZE_EXCEEDED,
      message: "projection.content exceeds maximum size",
    };
  }
  return {
    ok: true,
    projection: { id: obj.id, version: obj.version, content: obj.content },
  };
}

function validateV2SemanticProjectionStructure(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "semantic_projection must be a plain object",
    };
  }
  const obj = value as Record<string, unknown>;
  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected semantic_projection key: ${protoKey}`,
    };
  }
  const unknownErr = rejectUnknownKeys(obj, V2_SEMANTIC_PROJECTION_KEYS, "semantic_projection");
  if (unknownErr) return unknownErr;
  if (!isNonEmptyString(obj.id) || !isNonEmptyString(obj.version)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "semantic_projection id/version must be non-empty strings",
    };
  }
  if (!isHexSha256(obj.source_digest)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "semantic_projection.source_digest must be a 64-character hex string",
    };
  }
  return { ok: true, value: obj };
}

function validateV2GeneratedPayloadStructure(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "generated_payload must be a plain object",
    };
  }
  const obj = value as Record<string, unknown>;
  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected generated_payload key: ${protoKey}`,
    };
  }
  const unknownErr = rejectUnknownKeys(obj, V2_GENERATED_PAYLOAD_KEYS, "generated_payload");
  if (unknownErr) return unknownErr;
  if (!isNonEmptyString(obj.payload_id) || !isNonEmptyString(obj.payload_version)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "payload_id/payload_version must be non-empty strings",
    };
  }
  if (!isHexSha256(obj.payload_sha256)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "payload_sha256 must be a 64-character hex string",
    };
  }
  if (
    typeof obj.payload_bytecount !== "number" ||
    !Number.isInteger(obj.payload_bytecount) ||
    obj.payload_bytecount <= 0 ||
    obj.payload_bytecount > MAX_PROJECTION_CONTENT_BYTES
  ) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "payload_bytecount must be a positive integer <= 65536",
    };
  }
  if (!isNonEmptyString(obj.payload_filename)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "payload_filename must be a non-empty string",
    };
  }
  const expectedFilename = `${obj.payload_id}@${obj.payload_version}@${obj.payload_sha256}.json`;
  if (obj.payload_filename !== expectedFilename) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "payload_filename does not match the immutable filename contract",
    };
  }
  return { ok: true, value: obj };
}

function validateV2SourceManifestStructure(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "source_manifest must be a plain object",
    };
  }
  const obj = value as Record<string, unknown>;
  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected source_manifest key: ${protoKey}`,
    };
  }
  const unknownErr = rejectUnknownKeys(obj, V2_SOURCE_MANIFEST_KEYS, "source_manifest");
  if (unknownErr) return unknownErr;
  if (obj.manifest_id !== MANIFEST_ID) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "source_manifest.manifest_id must be canonical-source-manifest.v1",
    };
  }
  if (!isHexSha256(obj.manifest_digest)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "source_manifest.manifest_digest must be a 64-character hex string",
    };
  }
  return { ok: true, value: obj };
}

function validateV2AgentBindingStructure(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "agent_binding must be a plain object",
    };
  }
  const obj = value as Record<string, unknown>;
  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected agent_binding key: ${protoKey}`,
    };
  }
  const unknownErr = rejectUnknownKeys(obj, V2_AGENT_BINDING_KEYS, "agent_binding");
  if (unknownErr) return unknownErr;
  if (!isNonEmptyString(obj.agent_id)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "agent_binding.agent_id must be a non-empty string",
    };
  }
  return { ok: true, value: obj };
}

function validateV2RuntimeBindingStructure(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "runtime_binding must be a plain object",
    };
  }
  const obj = value as Record<string, unknown>;
  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected runtime_binding key: ${protoKey}`,
    };
  }
  const unknownErr = rejectUnknownKeys(obj, V2_RUNTIME_BINDING_KEYS, "runtime_binding");
  if (unknownErr) return unknownErr;
  if (
    !isNonEmptyString(obj.image_id) ||
    !isNonEmptyString(obj.source_commit) ||
    !isNonEmptyString(obj.source_tree)
  ) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "runtime_binding fields must be non-empty strings",
    };
  }
  return { ok: true, value: obj };
}

function validateV2ConfigBindingStructure(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "config_binding must be a plain object",
    };
  }
  const obj = value as Record<string, unknown>;
  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected config_binding key: ${protoKey}`,
    };
  }
  const unknownErr = rejectUnknownKeys(obj, V2_CONFIG_BINDING_KEYS, "config_binding");
  if (unknownErr) return unknownErr;
  if (!isHexSha256(obj.config_digest)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "config_binding.config_digest must be a 64-character hex string",
    };
  }
  return { ok: true, value: obj };
}

function validateV2PolicyBindingStructure(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "policy_binding must be a plain object",
    };
  }
  const obj = value as Record<string, unknown>;
  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected policy_binding key: ${protoKey}`,
    };
  }
  const unknownErr = rejectUnknownKeys(obj, V2_POLICY_BINDING_KEYS, "policy_binding");
  if (unknownErr) return unknownErr;
  for (const field of [
    "provider_policy",
    "model_policy",
    "preferred_auth_method",
    "fallback_policy",
  ]) {
    if (!isNonEmptyString(obj[field])) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: `${field} must be a non-empty string`,
      };
    }
  }
  return { ok: true, value: obj };
}

function validateV2CredentialRouteStructure(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "credential_route must be a plain object",
    };
  }
  const obj = value as Record<string, unknown>;
  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected credential_route key: ${protoKey}`,
    };
  }
  const unknownErr = rejectUnknownKeys(obj, V2_CREDENTIAL_ROUTE_KEYS, "credential_route");
  if (unknownErr) return unknownErr;
  if (!isNonEmptyString(obj.auth_method_policy)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "auth_method_policy must be a non-empty string",
    };
  }
  if (!CREDENTIAL_ROUTE_STATUSES.has(obj.credential_route_status as string)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "credential_route_status has an unsupported value",
    };
  }
  return { ok: true, value: obj };
}

function validateV2ValidatorStructure(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "validator must be a plain object",
    };
  }
  const obj = value as Record<string, unknown>;
  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected validator key: ${protoKey}`,
    };
  }
  const unknownErr = rejectUnknownKeys(obj, V2_VALIDATOR_KEYS, "validator");
  if (unknownErr) return unknownErr;
  if (!isNonEmptyString(obj.validator_id) || !isNonEmptyString(obj.validator_version)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "validator id/version must be non-empty strings",
    };
  }
  return { ok: true, value: obj };
}

function validateV2RevalidationStructure(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "revalidation must be a plain object",
    };
  }
  const obj = value as Record<string, unknown>;
  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected revalidation key: ${protoKey}`,
    };
  }
  const unknownErr = rejectUnknownKeys(obj, V2_REVALIDATION_KEYS, "revalidation");
  if (unknownErr) return unknownErr;
  if (typeof obj.revalidation_required !== "boolean") {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "revalidation_required must be a boolean",
    };
  }
  if (obj.reason !== null && typeof obj.reason !== "string") {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "revalidation.reason must be a string or null",
    };
  }
  if (!isNonEmptyString(obj.validator_version)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "revalidation.validator_version must be a non-empty string",
    };
  }
  return { ok: true, value: obj };
}

function validateV2ProvenanceStructure(
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "provenance must be a plain object",
    };
  }
  const obj = value as Record<string, unknown>;
  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected provenance key: ${protoKey}`,
    };
  }
  const unknownErr = rejectUnknownKeys(obj, V2_PROVENANCE_KEYS, "provenance");
  if (unknownErr) return unknownErr;
  if (!isNonEmptyString(obj.generator_id) || !isNonEmptyString(obj.generator_version)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "provenance generator_id/generator_version must be non-empty strings",
    };
  }
  return { ok: true, value: obj };
}

export function parseReadinessEnvelopeV2(input: string): V2CanonicalReadinessEnvelopeLoadResult {
  const parseResult = strictParse(input);
  if (!parseResult.ok) {
    return { ok: false, code: parseResult.code, message: parseResult.message };
  }

  if (!isPlainObject(parseResult.value)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "envelope must be a plain object",
    };
  }
  const obj = parseResult.value as Record<string, unknown>;

  const protoKey = rejectPrototypeKeys(obj);
  if (protoKey) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: `rejected key: ${protoKey}`,
    };
  }

  const unknownErr = rejectUnknownKeys(obj, V2_TOP_LEVEL_KEYS, "envelope");
  if (unknownErr) return unknownErr;

  if (obj.envelope_version !== ENVELOPE_VERSION_V2) {
    return {
      ok: false,
      code: ReadinessCode.UNSUPPORTED_CONTRACT_VERSION,
      message: `unsupported envelope version: ${String(obj.envelope_version)}`,
    };
  }
  if (!isNonEmptyString(obj.published_at) || !isValidIsoTimestamp(obj.published_at)) {
    return {
      ok: false,
      code: ReadinessCode.INVALID_TIMESTAMP,
      message: "published_at is not a valid ISO 8601 timestamp",
    };
  }
  if (!isNonEmptyString(obj.published_by)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "published_by must be a non-empty string",
    };
  }
  if (!isPlainObject(obj.evidence)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "evidence must be a plain object",
    };
  }

  const evidence = obj.evidence as Record<string, unknown>;
  const evidenceResult = validateV2EvidenceStructure(evidence);
  if (!evidenceResult.ok) return evidenceResult;

  // The downstream readiness.v2 validator validates the complete serialized
  // envelope (top-level envelope_version/published_at/published_by/evidence),
  // not the extracted evidence sub-object. Passing the full envelope here
  // keeps the loader -> evaluator -> validator contract exact.
  const envelopeJson = JSON.stringify(obj);

  if (evidence.decision === "BLOCKED") {
    if (obj.projection !== undefined || obj.binding !== undefined) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "BLOCKED envelope must not contain projection or binding",
      };
    }
    const blockedEnvelope: BlockedV2CanonicalReadinessEnvelope = {
      envelopeVersion: "readiness-envelope.v2",
      publishedAt: obj.published_at as string,
      publishedBy: obj.published_by as string,
      evidence: {
        contract_version: "readiness.v2",
        decision: "BLOCKED",
        classification: isNonEmptyString(evidence.classification)
          ? evidence.classification
          : undefined,
        reason: typeof evidence.reason === "string" ? evidence.reason : undefined,
        diagnostic_ref: isNonEmptyString(evidence.diagnostic_ref)
          ? evidence.diagnostic_ref
          : undefined,
      },
    };
    return { ok: true, envelope: blockedEnvelope, envelopeJson };
  }

  const readyEvidenceResult = validateV2ReadyEvidence(evidence);
  if (!readyEvidenceResult.ok) return readyEvidenceResult;

  const projectionResult = validateV2ProjectionStructure(obj.projection);
  if (!projectionResult.ok) return projectionResult;

  const bindingResult = validateBinding(obj.binding, projectionResult.projection.content);
  if (!bindingResult.ok) return bindingResult;

  const semanticResult = validateV2SemanticProjectionStructure(obj.semantic_projection);
  if (!semanticResult.ok) return semanticResult;
  const payloadResult = validateV2GeneratedPayloadStructure(obj.generated_payload);
  if (!payloadResult.ok) return payloadResult;
  const manifestResult = validateV2SourceManifestStructure(obj.source_manifest);
  if (!manifestResult.ok) return manifestResult;
  const agentResult = validateV2AgentBindingStructure(obj.agent_binding);
  if (!agentResult.ok) return agentResult;
  const runtimeResult = validateV2RuntimeBindingStructure(obj.runtime_binding);
  if (!runtimeResult.ok) return runtimeResult;
  const configResult = validateV2ConfigBindingStructure(obj.config_binding);
  if (!configResult.ok) return configResult;
  const policyResult = validateV2PolicyBindingStructure(obj.policy_binding);
  if (!policyResult.ok) return policyResult;
  const credentialResult = validateV2CredentialRouteStructure(obj.credential_route);
  if (!credentialResult.ok) return credentialResult;
  const validatorResult = validateV2ValidatorStructure(obj.validator);
  if (!validatorResult.ok) return validatorResult;
  const revalidationResult = validateV2RevalidationStructure(obj.revalidation);
  if (!revalidationResult.ok) return revalidationResult;
  const provenanceResult = validateV2ProvenanceStructure(obj.provenance);
  if (!provenanceResult.ok) return provenanceResult;

  const readyEnvelope: ReadyV2CanonicalReadinessEnvelope = {
    envelopeVersion: "readiness-envelope.v2",
    publishedAt: obj.published_at as string,
    publishedBy: obj.published_by as string,
    evidence: {
      contract_version: "readiness.v2",
      decision: "READY",
      valid_until: evidence.valid_until as string,
      classification: isNonEmptyString(evidence.classification)
        ? evidence.classification
        : undefined,
      reason: typeof evidence.reason === "string" ? evidence.reason : undefined,
      diagnostic_ref: isNonEmptyString(evidence.diagnostic_ref)
        ? evidence.diagnostic_ref
        : undefined,
      evaluated_at: evidence.evaluated_at as string,
    },
    projection: projectionResult.projection,
    binding: bindingResult.binding,
    semanticProjection: {
      id: semanticResult.value.id as string,
      version: semanticResult.value.version as string,
      sourceDigest: semanticResult.value.source_digest as string,
    },
    generatedPayload: {
      payloadId: payloadResult.value.payload_id as string,
      payloadVersion: payloadResult.value.payload_version as string,
      payloadSha256: payloadResult.value.payload_sha256 as string,
      payloadBytecount: payloadResult.value.payload_bytecount as number,
      payloadFilename: payloadResult.value.payload_filename as string,
    },
    sourceManifest: {
      manifestId: manifestResult.value.manifest_id as string,
      manifestDigest: manifestResult.value.manifest_digest as string,
    },
    agentBinding: { agentId: agentResult.value.agent_id as string },
    runtimeBinding: {
      imageId: runtimeResult.value.image_id as string,
      sourceCommit: runtimeResult.value.source_commit as string,
      sourceTree: runtimeResult.value.source_tree as string,
    },
    configBinding: { configDigest: configResult.value.config_digest as string },
    policyBinding: {
      providerPolicy: policyResult.value.provider_policy as string,
      modelPolicy: policyResult.value.model_policy as string,
      preferredAuthMethod: policyResult.value.preferred_auth_method as string,
      fallbackPolicy: policyResult.value.fallback_policy as string,
    },
    credentialRoute: {
      authMethodPolicy: credentialResult.value.auth_method_policy as string,
      credentialRouteStatus: credentialResult.value.credential_route_status as string,
    },
    validator: {
      validatorId: validatorResult.value.validator_id as string,
      validatorVersion: validatorResult.value.validator_version as string,
    },
    revalidation: {
      revalidationRequired: revalidationResult.value.revalidation_required as boolean,
      reason: revalidationResult.value.reason as string | null,
      validatorVersion: revalidationResult.value.validator_version as string,
    },
    provenance: {
      generatorId: provenanceResult.value.generator_id as string,
      generatorVersion: provenanceResult.value.generator_version as string,
    },
  };

  return {
    ok: true,
    envelope: readyEnvelope,
    envelopeJson,
    projection: projectionResult.projection,
  };
}
