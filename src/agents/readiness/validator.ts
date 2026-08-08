import { createHash } from "node:crypto";
import { ReadinessCode } from "./codes.js";
import { CONTRACT_VERSION_V2, MANIFEST_ID } from "./contracts-v2.js";
import type { ReadinessContractV1 } from "./types.js";

const SUPPORTED_CONTRACT_VERSION = "readiness.v1";
const MAX_DIAGNOSTIC_REF_LENGTH = 256;
const MAX_CLASSIFICATION_LENGTH = 128;
const MAX_REASON_LENGTH = 1024;
const SHA256_HEX_LENGTH = 64;
const HEX_RE = /^[0-9a-f]+$/u;
const MAX_PAYLOAD_BYTECOUNT = 65536;

const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type ValidationSuccess = {
  ok: true;
  contract: ReadinessContractV1;
};

export type ValidationError = {
  ok: false;
  code: string;
  message: string;
};

export type ValidationResult = ValidationSuccess | ValidationError;

export type ReadinessV2ValidationInput = {
  expectedAgentId: string;
  expectedImageId: string;
  expectedSourceCommit: string;
  expectedSourceTree: string;
  expectedConfigDigest: string;
  expectedProviderPolicy: string;
  expectedModelPolicy: string;
  expectedAuthMethodPolicy: string;
  expectedFallbackPolicy: string;
  expectedSemanticProjectionId: string;
  expectedSemanticProjectionVersion: string;
  expectedSemanticProjectionSourceDigest: string;
  expectedSourceManifestDigest: string;
  supportedValidatorId: string;
  supportedValidatorVersion: string;
  maximumAgeMs?: number;
  now: number;
};

export type ReadinessV2ValidationSuccess = {
  ok: true;
  contract: {
    contract_version: "readiness.v2";
    decision: "READY" | "BLOCKED";
    valid_until?: string;
    classification?: string;
    reason?: string;
    diagnostic_ref?: string;
    evaluated_at?: string;
  };
};

export type ReadinessV2ValidationResult = ReadinessV2ValidationSuccess | ValidationError;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isValidIsoTimestamp(s: string): boolean {
  const d = new Date(s);
  if (isNaN(d.getTime())) return false;
  return d.toISOString() === s || s.endsWith("Z") || s.includes("+") || s.includes("T");
}

function hasOwnProperty(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function validateReadinessContract(
  value: unknown,
  now: number,
  maximumAgeMs?: number,
  expectedProjectionId?: string,
  expectedProjectionVersion?: string,
): ValidationResult {
  if (!isPlainObject(value)) {
    return { ok: false, code: ReadinessCode.EVIDENCE_MALFORMED, message: "not a plain object" };
  }

  const obj = value as Record<string, unknown>;

  for (const key of PROTOTYPE_KEYS) {
    if (hasOwnProperty(obj, key)) {
      return { ok: false, code: ReadinessCode.EVIDENCE_MALFORMED, message: `rejected key: ${key}` };
    }
  }

  if (obj.contract_version !== SUPPORTED_CONTRACT_VERSION) {
    return {
      ok: false,
      code: ReadinessCode.UNSUPPORTED_CONTRACT_VERSION,
      message: `unsupported contract version: ${String(obj.contract_version)}`,
    };
  }

  if (typeof obj.contract_version !== "string" || obj.contract_version.trim().length === 0) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "contract_version must be a non-empty string",
    };
  }

  if (obj.decision !== "READY" && obj.decision !== "BLOCKED") {
    return {
      ok: false,
      code: ReadinessCode.INVALID_DECISION,
      message: `invalid decision: ${String(obj.decision)}`,
    };
  }

  if (obj.decision === "READY") {
    if (obj.valid_until !== undefined) {
      if (typeof obj.valid_until !== "string" || !isValidIsoTimestamp(obj.valid_until)) {
        return {
          ok: false,
          code: ReadinessCode.INVALID_TIMESTAMP,
          message: "valid_until is not a valid ISO 8601 timestamp",
        };
      }
      const expiryMs = new Date(obj.valid_until).getTime();
      if (expiryMs <= now) {
        return {
          ok: false,
          code: ReadinessCode.READINESS_EXPIRED,
          message: "readiness has expired",
        };
      }
    } else if (maximumAgeMs !== undefined && maximumAgeMs > 0) {
      const evaluatedAt = obj.evaluated_at;
      if (typeof evaluatedAt === "string" && isValidIsoTimestamp(evaluatedAt)) {
        const evalMs = new Date(evaluatedAt).getTime();
        if (now - evalMs > maximumAgeMs) {
          return {
            ok: false,
            code: ReadinessCode.READINESS_EXPIRED,
            message: "readiness exceeded maximum age",
          };
        }
      } else {
        return {
          ok: false,
          code: ReadinessCode.READINESS_EXPIRED,
          message: "no valid_until and no valid evaluated_at for maximumAge check",
        };
      }
    } else {
      return {
        ok: false,
        code: ReadinessCode.READINESS_EXPIRED,
        message: "no valid_until and no maximumAgeMs configured",
      };
    }
  }

  if (obj.classification !== undefined) {
    if (typeof obj.classification !== "string" || obj.classification.trim().length === 0) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "classification must be a non-empty string",
      };
    }
    if (obj.classification.length > MAX_CLASSIFICATION_LENGTH) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "classification too long",
      };
    }
  }

  if (obj.reason !== undefined && typeof obj.reason === "string") {
    if (obj.reason.length > MAX_REASON_LENGTH) {
      return { ok: false, code: ReadinessCode.EVIDENCE_MALFORMED, message: "reason too long" };
    }
  }

  if (obj.diagnostic_ref !== undefined) {
    if (typeof obj.diagnostic_ref !== "string" || obj.diagnostic_ref.trim().length === 0) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "diagnostic_ref must be a non-empty string",
      };
    }
    if (obj.diagnostic_ref.length > MAX_DIAGNOSTIC_REF_LENGTH) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "diagnostic_ref too long",
      };
    }
  }

  if (obj.projection_id !== undefined) {
    if (typeof obj.projection_id !== "string" || obj.projection_id.trim().length === 0) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "projection_id must be a non-empty string",
      };
    }
  }

  if (obj.projection_version !== undefined) {
    if (typeof obj.projection_version !== "string" || obj.projection_version.trim().length === 0) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "projection_version must be a non-empty string",
      };
    }
  }

  if (expectedProjectionId !== undefined) {
    const pid = obj.projection_id;
    if (pid !== expectedProjectionId) {
      return {
        ok: false,
        code: ReadinessCode.PROJECTION_BINDING_MISMATCH,
        message: `projection_id mismatch: expected ${expectedProjectionId}, got ${String(pid)}`,
      };
    }
  }

  if (expectedProjectionVersion !== undefined) {
    const pv = obj.projection_version;
    if (pv !== expectedProjectionVersion) {
      return {
        ok: false,
        code: ReadinessCode.PROJECTION_BINDING_MISMATCH,
        message: `projection_version mismatch: expected ${expectedProjectionVersion}, got ${String(pv)}`,
      };
    }
  }

  const contract: ReadinessContractV1 = {
    contract_version: "readiness.v1",
    decision: obj.decision as "READY" | "BLOCKED",
  };

  if (typeof obj.valid_until === "string") contract.valid_until = obj.valid_until;
  if (typeof obj.classification === "string") contract.classification = obj.classification;
  if (typeof obj.reason === "string") contract.reason = obj.reason;
  if (typeof obj.diagnostic_ref === "string") contract.diagnostic_ref = obj.diagnostic_ref;
  if (typeof obj.evaluated_at === "string") contract.evaluated_at = obj.evaluated_at;
  if (typeof obj.projection_id === "string") contract.projection_id = obj.projection_id;
  if (typeof obj.projection_version === "string")
    contract.projection_version = obj.projection_version;

  return { ok: true, contract };
}

function isHexSha256(value: unknown): value is string {
  return typeof value === "string" && value.length === SHA256_HEX_LENGTH && HEX_RE.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveBoundedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
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
): ValidationError | null {
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

const V2_PROJECTION_KEYS = new Set(["id", "version", "content"]);
const V2_BINDING_KEYS = new Set(["kind", "projection_sha256"]);
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

function validateV2Evidence(
  evidence: Record<string, unknown>,
  now: number,
  maximumAgeMs: number | undefined,
): ValidationError | null {
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
      evidence.classification.length > MAX_CLASSIFICATION_LENGTH
    ) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "classification must be a non-empty string within length limit",
      };
    }
  }
  if (evidence.reason !== undefined && typeof evidence.reason === "string") {
    if (evidence.reason.length > MAX_REASON_LENGTH) {
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
      evidence.diagnostic_ref.length > MAX_DIAGNOSTIC_REF_LENGTH
    ) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "diagnostic_ref must be a non-empty string within length limit",
      };
    }
  }

  if (evidence.decision === "READY") {
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
    if (new Date(evidence.valid_until as string).getTime() <= now) {
      return { ok: false, code: ReadinessCode.READINESS_EXPIRED, message: "readiness has expired" };
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
    if (maximumAgeMs !== undefined && maximumAgeMs > 0) {
      const evalMs = new Date(evidence.evaluated_at as string).getTime();
      if (now - evalMs > maximumAgeMs) {
        return {
          ok: false,
          code: ReadinessCode.READINESS_EXPIRED,
          message: "readiness exceeded maximum age",
        };
      }
    }
  }
  return null;
}

function validateV2Projection(projection: unknown): ValidationError | null {
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
  const unknownErr = rejectUnknownKeys(obj, V2_PROJECTION_KEYS, "projection");
  if (unknownErr) return unknownErr;
  if (
    !isNonEmptyString(obj.id) ||
    !isNonEmptyString(obj.version) ||
    typeof obj.content !== "string"
  ) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "projection id/version/content invalid",
    };
  }
  if (new TextEncoder().encode(obj.content).length > 65536) {
    return {
      ok: false,
      code: ReadinessCode.MAXIMUM_SIZE_EXCEEDED,
      message: "projection.content exceeds maximum size",
    };
  }
  return null;
}

function validateV2Binding(binding: unknown, projectionContent: string): ValidationError | null {
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
  const unknownErr = rejectUnknownKeys(obj, V2_BINDING_KEYS, "binding");
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
  return null;
}

function validateV2SemanticProjection(
  value: unknown,
  input: ReadinessV2ValidationInput,
): ValidationError | null {
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
  if (obj.id !== input.expectedSemanticProjectionId) {
    return {
      ok: false,
      code: "SEMANTIC_PROJECTION_MISMATCH",
      message: "semantic projection id mismatch",
    };
  }
  if (obj.version !== input.expectedSemanticProjectionVersion) {
    return {
      ok: false,
      code: "SEMANTIC_PROJECTION_MISMATCH",
      message: "semantic projection version mismatch",
    };
  }
  if (obj.source_digest !== input.expectedSemanticProjectionSourceDigest) {
    return {
      ok: false,
      code: "SEMANTIC_PROJECTION_MISMATCH",
      message: "semantic projection source digest mismatch",
    };
  }
  return null;
}

function validateV2GeneratedPayload(value: unknown): ValidationError | null {
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
    !isPositiveBoundedInteger(obj.payload_bytecount) ||
    obj.payload_bytecount > MAX_PAYLOAD_BYTECOUNT
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
  return null;
}

function validateV2SourceManifest(
  value: unknown,
  expectedManifestDigest: string,
): ValidationError | null {
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
  if (obj.manifest_digest !== expectedManifestDigest) {
    return {
      ok: false,
      code: "SOURCE_MANIFEST_MISMATCH",
      message: "source manifest digest mismatch",
    };
  }
  return null;
}

function validateV2AgentBinding(value: unknown, expectedAgentId: string): ValidationError | null {
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
  if (obj.agent_id !== expectedAgentId) {
    return { ok: false, code: "AGENT_BINDING_MISMATCH", message: "agent binding mismatch" };
  }
  return null;
}

function validateV2RuntimeBinding(
  value: unknown,
  input: ReadinessV2ValidationInput,
): ValidationError | null {
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
  if (obj.image_id !== input.expectedImageId) {
    return {
      ok: false,
      code: "RUNTIME_BINDING_MISMATCH",
      message: "runtime image binding mismatch",
    };
  }
  if (obj.source_commit !== input.expectedSourceCommit) {
    return {
      ok: false,
      code: "RUNTIME_BINDING_MISMATCH",
      message: "runtime source commit binding mismatch",
    };
  }
  if (obj.source_tree !== input.expectedSourceTree) {
    return {
      ok: false,
      code: "RUNTIME_BINDING_MISMATCH",
      message: "runtime source tree binding mismatch",
    };
  }
  return null;
}

function validateV2ConfigBinding(
  value: unknown,
  expectedConfigDigest: string,
): ValidationError | null {
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
  if (obj.config_digest !== expectedConfigDigest) {
    return { ok: false, code: "CONFIG_BINDING_MISMATCH", message: "config binding mismatch" };
  }
  return null;
}

function validateV2PolicyBinding(
  value: unknown,
  input: ReadinessV2ValidationInput,
): ValidationError | null {
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
  if (obj.provider_policy !== input.expectedProviderPolicy) {
    return { ok: false, code: "PROVIDER_POLICY_MISMATCH", message: "provider policy mismatch" };
  }
  if (obj.model_policy !== input.expectedModelPolicy) {
    return { ok: false, code: "MODEL_POLICY_MISMATCH", message: "model policy mismatch" };
  }
  if (obj.preferred_auth_method !== input.expectedAuthMethodPolicy) {
    return { ok: false, code: "PROFILE_POLICY_MISMATCH", message: "auth method policy mismatch" };
  }
  if (obj.fallback_policy !== input.expectedFallbackPolicy) {
    return { ok: false, code: "FALLBACK_POLICY_VIOLATION", message: "fallback policy violation" };
  }
  return null;
}

function validateV2CredentialRoute(
  value: unknown,
  expectedAuthMethodPolicy: string,
): ValidationError | null {
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
  if (obj.auth_method_policy !== expectedAuthMethodPolicy) {
    return { ok: false, code: "PROFILE_POLICY_MISMATCH", message: "auth method policy mismatch" };
  }
  if (!CREDENTIAL_ROUTE_STATUSES.has(obj.credential_route_status as string)) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "credential_route_status has an unsupported value",
    };
  }
  if (obj.credential_route_status !== "AVAILABLE_VERIFIED") {
    return {
      ok: false,
      code: "CREDENTIAL_ROUTE_NOT_READY",
      message: "credential route is not ready for production execution",
    };
  }
  return null;
}

function validateV2Validator(
  value: unknown,
  input: ReadinessV2ValidationInput,
): ValidationError | null {
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
  if (
    obj.validator_id !== input.supportedValidatorId ||
    obj.validator_version !== input.supportedValidatorVersion
  ) {
    return {
      ok: false,
      code: "VALIDATOR_VERSION_UNSUPPORTED",
      message: "validator identity/version is not supported",
    };
  }
  return null;
}

function validateV2Revalidation(value: unknown): ValidationError | null {
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
  if (obj.revalidation_required === true) {
    return { ok: false, code: "REVALIDATION_REQUIRED", message: "revalidation is required" };
  }
  return null;
}

function validateV2Provenance(value: unknown): ValidationError | null {
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
  return null;
}

export function validateReadinessContractV2(
  value: unknown,
  input: ReadinessV2ValidationInput,
): ReadinessV2ValidationResult {
  if (!isPlainObject(value)) {
    return { ok: false, code: ReadinessCode.EVIDENCE_MALFORMED, message: "not a plain object" };
  }
  const obj = value as Record<string, unknown>;

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

  if (obj.envelope_version !== "readiness-envelope.v2") {
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
  const evidenceErr = validateV2Evidence(evidence, input.now, input.maximumAgeMs);
  if (evidenceErr) return evidenceErr;

  if (evidence.decision === "BLOCKED") {
    if (obj.projection !== undefined || obj.binding !== undefined) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "BLOCKED envelope must not contain projection or binding",
      };
    }
    return {
      ok: true,
      contract: {
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
  }

  const projectionErr = validateV2Projection(obj.projection);
  if (projectionErr) return projectionErr;
  const bindingErr = validateV2Binding(
    obj.binding,
    (obj.projection as Record<string, unknown>).content as string,
  );
  if (bindingErr) return bindingErr;

  const semanticErr = validateV2SemanticProjection(obj.semantic_projection, input);
  if (semanticErr) return semanticErr;
  const payloadErr = validateV2GeneratedPayload(obj.generated_payload);
  if (payloadErr) return payloadErr;
  const manifestErr = validateV2SourceManifest(
    obj.source_manifest,
    input.expectedSourceManifestDigest,
  );
  if (manifestErr) return manifestErr;
  const agentErr = validateV2AgentBinding(obj.agent_binding, input.expectedAgentId);
  if (agentErr) return agentErr;
  const runtimeErr = validateV2RuntimeBinding(obj.runtime_binding, input);
  if (runtimeErr) return runtimeErr;
  const configErr = validateV2ConfigBinding(obj.config_binding, input.expectedConfigDigest);
  if (configErr) return configErr;
  const policyErr = validateV2PolicyBinding(obj.policy_binding, input);
  if (policyErr) return policyErr;
  const credentialErr = validateV2CredentialRoute(
    obj.credential_route,
    input.expectedAuthMethodPolicy,
  );
  if (credentialErr) return credentialErr;
  const validatorErr = validateV2Validator(obj.validator, input);
  if (validatorErr) return validatorErr;
  const revalidationErr = validateV2Revalidation(obj.revalidation);
  if (revalidationErr) return revalidationErr;
  const provenanceErr = validateV2Provenance(obj.provenance);
  if (provenanceErr) return provenanceErr;

  return {
    ok: true,
    contract: {
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
  };
}
