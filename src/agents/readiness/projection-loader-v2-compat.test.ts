import { describe, it, expect } from "vitest";
import { ReadinessCode } from "./codes.js";
import { createReadinessProjectionLoader } from "./projection-loader.js";

describe("createReadinessProjectionLoader V2 compatibility gating", () => {
  it("V1 compatibility path keeps the in-memory evidence projection", async () => {
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
      expect(result.projection.content).toBe(evidence);
    }
  });

  it("V2 production route cannot select the V1 evidence projection as generated semantic payload", async () => {
    const evidence = JSON.stringify({
      envelope_version: "readiness-envelope.v2",
      contract_version: "readiness.v2",
      decision: "READY",
      projection_id: "test-proj",
      projection_version: "1.0.0",
    });
    const loader = createReadinessProjectionLoader({ evidenceJson: evidence });
    const result = await loader({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ReadinessCode.UNSUPPORTED_CONTRACT_VERSION);
    }
  });

  it("V1 evidence without contract_version still loads (legacy compatibility)", async () => {
    const evidence = JSON.stringify({ decision: "READY" });
    const loader = createReadinessProjectionLoader({ evidenceJson: evidence });
    const result = await loader({});
    expect(result.ok).toBe(true);
  });
});
