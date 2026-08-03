import { describe, it, expect } from "vitest";
import { validateReadinessContract } from "./validator.js";

const NOW = 2000000000000;
const FUTURE = new Date(NOW + 86400000).toISOString();
const PAST = new Date(NOW - 86400000).toISOString();

describe("validateReadinessContract", () => {
  it("accepts valid READY contract with valid_until", () => {
    const result = validateReadinessContract(
      { contract_version: "readiness.v1", decision: "READY", valid_until: FUTURE },
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects unsupported contract version", () => {
    const result = validateReadinessContract(
      { contract_version: "readiness.v0", decision: "READY" },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
  });

  it("rejects expired valid_until", () => {
    const result = validateReadinessContract(
      { contract_version: "readiness.v1", decision: "READY", valid_until: PAST },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("READINESS_EXPIRED");
  });

  it("rejects missing valid_until and no maximumAgeMs", () => {
    const result = validateReadinessContract(
      { contract_version: "readiness.v1", decision: "READY" },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("READINESS_EXPIRED");
  });

  it("accepts READY with valid maximumAgeMs and evaluated_at", () => {
    const recent = new Date(NOW - 1000).toISOString();
    const result = validateReadinessContract(
      { contract_version: "readiness.v1", decision: "READY", evaluated_at: recent },
      NOW,
      5000,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects READY exceeding maximumAgeMs", () => {
    const old = new Date(NOW - 10000).toISOString();
    const result = validateReadinessContract(
      { contract_version: "readiness.v1", decision: "READY", evaluated_at: old },
      NOW,
      5000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("READINESS_EXPIRED");
  });

  it("accepts BLOCKED contract", () => {
    const result = validateReadinessContract(
      { contract_version: "readiness.v1", decision: "BLOCKED" },
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects invalid decision", () => {
    const result = validateReadinessContract(
      { contract_version: "readiness.v1", decision: "MAYBE" },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_DECISION");
  });

  it("rejects invalid timestamp", () => {
    const result = validateReadinessContract(
      { contract_version: "readiness.v1", decision: "READY", valid_until: "not-a-date" },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_TIMESTAMP");
  });

  it("rejects projection_id mismatch", () => {
    const result = validateReadinessContract(
      {
        contract_version: "readiness.v1",
        decision: "READY",
        valid_until: FUTURE,
        projection_id: "wrong",
      },
      NOW,
      undefined,
      "expected-id",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PROJECTION_BINDING_MISMATCH");
  });

  it("accepts matching projection_id", () => {
    const result = validateReadinessContract(
      {
        contract_version: "readiness.v1",
        decision: "READY",
        valid_until: FUTURE,
        projection_id: "match",
      },
      NOW,
      undefined,
      "match",
    );
    expect(result.ok).toBe(true);
  });

  it("rejects projection_version mismatch", () => {
    const result = validateReadinessContract(
      {
        contract_version: "readiness.v1",
        decision: "READY",
        valid_until: FUTURE,
        projection_version: "v1",
      },
      NOW,
      undefined,
      undefined,
      "v2",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PROJECTION_BINDING_MISMATCH");
  });

  it("rejects non-plain-object input", () => {
    const result = validateReadinessContract("string", NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects array input", () => {
    const result = validateReadinessContract([], NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MALFORMED");
  });

  it("accepts unknown benign fields", () => {
    const result = validateReadinessContract(
      {
        contract_version: "readiness.v1",
        decision: "READY",
        valid_until: FUTURE,
        extra_field: "ok",
      },
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects __proto__ key", () => {
    const result = validateReadinessContract(
      {
        contract_version: "readiness.v1",
        decision: "READY",
        valid_until: FUTURE,
        __proto__: { pollute: true },
      },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects constructor key", () => {
    const result = validateReadinessContract(
      { contract_version: "readiness.v1", decision: "READY", valid_until: FUTURE, constructor: {} },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects prototype key", () => {
    const result = validateReadinessContract(
      { contract_version: "readiness.v1", decision: "READY", valid_until: FUTURE, prototype: {} },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects empty contract_version", () => {
    const result = validateReadinessContract({ contract_version: "", decision: "READY" }, NOW);
    expect(result.ok).toBe(false);
  });

  it("rejects empty projection_id", () => {
    const result = validateReadinessContract(
      {
        contract_version: "readiness.v1",
        decision: "READY",
        valid_until: FUTURE,
        projection_id: "",
      },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects empty diagnostic_ref", () => {
    const result = validateReadinessContract(
      {
        contract_version: "readiness.v1",
        decision: "READY",
        valid_until: FUTURE,
        diagnostic_ref: "",
      },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("accepts Object.create(null) as plain object", () => {
    const obj = Object.create(null);
    obj.contract_version = "readiness.v1";
    obj.decision = "READY";
    obj.valid_until = FUTURE;
    const result = validateReadinessContract(obj, NOW);
    expect(result.ok).toBe(true);
  });
});
