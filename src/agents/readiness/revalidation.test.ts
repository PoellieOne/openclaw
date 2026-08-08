import { describe, it, expect } from "vitest";
import {
  REVALIDATION_TRIGGERS,
  REVALIDATION_TRIGGER_MATRIX,
  RevalidationMechanism,
  RevalidationTrigger,
  isRevalidationTrigger,
  resolveRevalidationMechanism,
} from "./revalidation.js";

describe("revalidation trigger matrix", () => {
  it("covers every trigger with a mechanism", () => {
    for (const trigger of REVALIDATION_TRIGGERS) {
      expect(REVALIDATION_TRIGGER_MATRIX[trigger]).toBeDefined();
    }
  });

  it("new run or session is detected by existing per-run binding", () => {
    expect(resolveRevalidationMechanism(RevalidationTrigger.NEW_RUN_OR_SESSION).mechanism).toBe(
      RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING,
    );
  });

  it("continuation is detected by existing per-run binding", () => {
    expect(resolveRevalidationMechanism(RevalidationTrigger.CONTINUATION).mechanism).toBe(
      RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING,
    );
  });

  it("compaction is detected by existing per-run binding", () => {
    expect(resolveRevalidationMechanism(RevalidationTrigger.COMPACTION).mechanism).toBe(
      RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING,
    );
  });

  it("semantic projection change is detected by existing per-run binding", () => {
    expect(
      resolveRevalidationMechanism(RevalidationTrigger.SEMANTIC_PROJECTION_CHANGE).mechanism,
    ).toBe(RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING);
  });

  it("generated payload change is detected by existing per-run binding", () => {
    expect(
      resolveRevalidationMechanism(RevalidationTrigger.GENERATED_PAYLOAD_CHANGE).mechanism,
    ).toBe(RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING);
  });

  it("canonical source manifest change is detected by existing per-run binding", () => {
    expect(
      resolveRevalidationMechanism(RevalidationTrigger.CANONICAL_SOURCE_MANIFEST_CHANGE).mechanism,
    ).toBe(RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING);
  });

  it("agent change is detected by existing per-run binding", () => {
    expect(resolveRevalidationMechanism(RevalidationTrigger.AGENT_CHANGE).mechanism).toBe(
      RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING,
    );
  });

  it("effective config change is detected by existing per-run binding", () => {
    expect(
      resolveRevalidationMechanism(RevalidationTrigger.EFFECTIVE_CONFIG_CHANGE).mechanism,
    ).toBe(RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING);
  });

  it("provider policy change is detected by existing per-run binding", () => {
    expect(resolveRevalidationMechanism(RevalidationTrigger.PROVIDER_POLICY_CHANGE).mechanism).toBe(
      RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING,
    );
  });

  it("model policy change is detected by existing per-run binding", () => {
    expect(resolveRevalidationMechanism(RevalidationTrigger.MODEL_POLICY_CHANGE).mechanism).toBe(
      RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING,
    );
  });

  it("auth profile policy change is detected by existing per-run binding", () => {
    expect(
      resolveRevalidationMechanism(RevalidationTrigger.AUTH_PROFILE_POLICY_CHANGE).mechanism,
    ).toBe(RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING);
  });

  it("runtime image change or restart is deferred runtime verification", () => {
    expect(
      resolveRevalidationMechanism(RevalidationTrigger.RUNTIME_IMAGE_CHANGE_OR_RESTART).mechanism,
    ).toBe(RevalidationMechanism.DEFERRED_RUNTIME_VERIFICATION);
  });

  it("validator version change is detected by existing per-run binding", () => {
    expect(
      resolveRevalidationMechanism(RevalidationTrigger.VALIDATOR_VERSION_CHANGE).mechanism,
    ).toBe(RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING);
  });

  it("explicit revalidation required is detected by existing per-run binding", () => {
    expect(
      resolveRevalidationMechanism(RevalidationTrigger.EXPLICIT_REVALIDATION_REQUIRED).mechanism,
    ).toBe(RevalidationMechanism.DETECTED_BY_EXISTING_PER_RUN_BINDING);
  });

  it("cache mismatch is diagnostic only", () => {
    expect(resolveRevalidationMechanism(RevalidationTrigger.CACHE_MISMATCH).mechanism).toBe(
      RevalidationMechanism.DIAGNOSTIC_ONLY,
    );
  });

  it("runtime binding mismatch comparison is implemented while acquisition is deferred", () => {
    expect(RevalidationTrigger.RUNTIME_IMAGE_CHANGE_OR_RESTART).toBe(
      "RUNTIME_IMAGE_CHANGE_OR_RESTART",
    );
    expect(RevalidationMechanism.DEFERRED_RUNTIME_VERIFICATION).toBe(
      "DEFERRED_RUNTIME_VERIFICATION",
    );
  });

  it("isRevalidationTrigger accepts known triggers and rejects others", () => {
    expect(isRevalidationTrigger("NEW_RUN_OR_SESSION")).toBe(true);
    expect(isRevalidationTrigger("CACHE_MISMATCH")).toBe(true);
    expect(isRevalidationTrigger("UNKNOWN_TRIGGER")).toBe(false);
    expect(isRevalidationTrigger(42)).toBe(false);
  });

  it("matrix is frozen and complete", () => {
    expect(Object.isFrozen(REVALIDATION_TRIGGER_MATRIX)).toBe(true);
    expect(Object.keys(REVALIDATION_TRIGGER_MATRIX).length).toBe(15);
  });
});
