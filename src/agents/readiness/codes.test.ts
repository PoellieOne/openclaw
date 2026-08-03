import { describe, it, expect } from "vitest";
import { ReadinessCode } from "./codes.js";

describe("ReadinessCode", () => {
  it("has all expected codes", () => {
    expect(ReadinessCode.POLICY_REQUIRED).toBe("POLICY_REQUIRED");
    expect(ReadinessCode.POLICY_EXPLICITLY_DISABLED_NON_PRODUCTION).toBe(
      "POLICY_EXPLICITLY_DISABLED_NON_PRODUCTION",
    );
    expect(ReadinessCode.POLICY_NOT_APPLICABLE).toBe("POLICY_NOT_APPLICABLE");
    expect(ReadinessCode.POLICY_UNRESOLVED).toBe("POLICY_UNRESOLVED");
    expect(ReadinessCode.POLICY_CONFLICT).toBe("POLICY_CONFLICT");
    expect(ReadinessCode.POLICY_DISABLE_NOT_AUTHORIZED).toBe("POLICY_DISABLE_NOT_AUTHORIZED");
    expect(ReadinessCode.POLICY_DISABLE_ON_PRODUCTION).toBe("POLICY_DISABLE_ON_PRODUCTION");
    expect(ReadinessCode.POLICY_ENVIRONMENT_UNRESOLVED).toBe("POLICY_ENVIRONMENT_UNRESOLVED");
    expect(ReadinessCode.EVIDENCE_MISSING).toBe("EVIDENCE_MISSING");
    expect(ReadinessCode.EVIDENCE_MALFORMED).toBe("EVIDENCE_MALFORMED");
    expect(ReadinessCode.DUPLICATE_KEY).toBe("DUPLICATE_KEY");
    expect(ReadinessCode.UNSUPPORTED_CONTRACT_VERSION).toBe("UNSUPPORTED_CONTRACT_VERSION");
    expect(ReadinessCode.INVALID_DECISION).toBe("INVALID_DECISION");
    expect(ReadinessCode.INVALID_TIMESTAMP).toBe("INVALID_TIMESTAMP");
    expect(ReadinessCode.READINESS_EXPIRED).toBe("READINESS_EXPIRED");
    expect(ReadinessCode.PROJECTION_BINDING_MISSING).toBe("PROJECTION_BINDING_MISSING");
    expect(ReadinessCode.PROJECTION_BINDING_MISMATCH).toBe("PROJECTION_BINDING_MISMATCH");
    expect(ReadinessCode.MAXIMUM_SIZE_EXCEEDED).toBe("MAXIMUM_SIZE_EXCEEDED");
    expect(ReadinessCode.MAXIMUM_DEPTH_EXCEEDED).toBe("MAXIMUM_DEPTH_EXCEEDED");
    expect(ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED).toBe(
      "INTERNAL_EVALUATION_FAILURE_SANITIZED",
    );
  });

  it("all codes are frozen strings", () => {
    const codes = Object.values(ReadinessCode);
    for (const code of codes) {
      expect(typeof code).toBe("string");
    }
  });
});
