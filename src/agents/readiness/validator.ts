import { ReadinessCode } from "./codes.js";
import type { ReadinessContractV1 } from "./types.js";

const SUPPORTED_CONTRACT_VERSION = "readiness.v1";
const MAX_DIAGNOSTIC_REF_LENGTH = 256;
const MAX_CLASSIFICATION_LENGTH = 128;
const MAX_REASON_LENGTH = 1024;

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
