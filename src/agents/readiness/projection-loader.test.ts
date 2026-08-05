import { describe, it, expect } from "vitest";
import { ReadinessCode } from "./codes.js";
import { createReadinessProjectionLoader } from "./projection-loader.js";

describe("createReadinessProjectionLoader", () => {
  it("returns projection from valid evidence JSON", async () => {
    const evidence = JSON.stringify({
      contract_version: "readiness.v1",
      decision: "READY",
      projection_id: "test-proj",
      projection_version: "1.0.0",
    });
    const loader = createReadinessProjectionLoader({ evidenceJson: evidence });
    const result = await loader({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projection.id).toBe("test-proj");
      expect(result.projection.version).toBe("1.0.0");
      expect(result.projection.content).toBe(evidence);
    }
  });

  it("preserves exact content bytes", async () => {
    const evidence = JSON.stringify({
      contract_version: "readiness.v1",
      decision: "READY",
      projection_id: "p1",
      projection_version: "1",
    });
    const loader = createReadinessProjectionLoader({ evidenceJson: evidence });
    const result = await loader({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projection.content).toBe(evidence);
    }
  });

  it("rejects evidence exceeding size limit", async () => {
    const large = '{"x":"' + "a".repeat(65530) + '"}';
    const loader = createReadinessProjectionLoader({ evidenceJson: large });
    const result = await loader({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ReadinessCode.MAXIMUM_SIZE_EXCEEDED);
    }
  });

  it("rejects malformed JSON", async () => {
    const loader = createReadinessProjectionLoader({ evidenceJson: "{invalid}" });
    const result = await loader({});
    expect(result.ok).toBe(false);
  });

  it("rejects non-object JSON", async () => {
    const loader = createReadinessProjectionLoader({ evidenceJson: '"string"' });
    const result = await loader({});
    expect(result.ok).toBe(false);
  });

  it("rejects array JSON", async () => {
    const loader = createReadinessProjectionLoader({ evidenceJson: "[]" });
    const result = await loader({});
    expect(result.ok).toBe(false);
  });

  it("sanitizes errors on unexpected failure", async () => {
    const loader = createReadinessProjectionLoader({ evidenceJson: "" });
    const result = await loader({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED);
    }
  });

  it("extracts empty id and version when fields are missing", async () => {
    const evidence = JSON.stringify({ contract_version: "readiness.v1", decision: "READY" });
    const loader = createReadinessProjectionLoader({ evidenceJson: evidence });
    const result = await loader({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projection.id).toBe("");
      expect(result.projection.version).toBe("");
    }
  });
});
