import { createHash } from "node:crypto";
import { ReadinessCode } from "./codes.js";
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
