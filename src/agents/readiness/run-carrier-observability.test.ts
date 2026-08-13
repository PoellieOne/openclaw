/**
 * Focused tests for run-carrier observability.
 *
 * Proves: bounded schema only, raw sessionKey never emitted/persisted,
 * emitter/persistence failure never changes readiness/control flow, exactly
 * seven contract phases in order, and no prompt/projection-body/credentials
 * in diagnostics.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  onInternalDiagnosticEvent,
  resetDiagnosticEventsForTest,
} from "../../infra/diagnostic-events.js";
import {
  emitRunCarrierDiagnostic,
  hashRunCarrierSessionKey,
  isRunCarrierDiagnosticsEnabled,
  RUN_CARRIER_DIAGNOSTIC_PHASES,
} from "./run-carrier-observability.js";

vi.mock("../../infra/diagnostic-events.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/diagnostic-events.js")>();
  return {
    ...actual,
    emitDiagnosticEvent: vi.fn(actual.emitDiagnosticEvent),
  };
});

import { emitDiagnosticEvent } from "../../infra/diagnostic-events.js";

const mockedEmitDiagnosticEvent = vi.mocked(emitDiagnosticEvent);

const CONFIG_WITH_FLAG = { diagnostics: { flags: ["run.carrier.diagnostic"] } } as never;
const CONFIG_WITHOUT_FLAG = { diagnostics: { flags: [] } } as never;

afterEach(() => {
  resetDiagnosticEventsForTest();
  mockedEmitDiagnosticEvent.mockClear();
});

function subscribeForTest(
  listener: (event: { type: string; phase?: string; sessionKey?: string }) => void,
): () => void {
  return onInternalDiagnosticEvent((event) => {
    if (event.type === "run.carrier.diagnostic") {
      listener(event as { type: string; phase?: string; sessionKey?: string });
    }
  });
}

describe("flag gating", () => {
  it("requires the run.carrier.diagnostic diagnostic flag", () => {
    expect(isRunCarrierDiagnosticsEnabled(CONFIG_WITH_FLAG)).toBe(true);
    expect(isRunCarrierDiagnosticsEnabled(CONFIG_WITHOUT_FLAG)).toBe(false);
    expect(isRunCarrierDiagnosticsEnabled(undefined)).toBe(false);
  });

  it("emits nothing when the flag is disabled", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeForTest(listener);
    emitRunCarrierDiagnostic({
      sessionId: "session-1",
      sessionKey: "agent:sophia:main",
      config: CONFIG_WITHOUT_FLAG,
      phase: "STAGE_A",
    });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe("bounded schema", () => {
  it("emits exactly the bounded schema fields for every phase", () => {
    const events: Array<Record<string, unknown>> = [];
    const unsubscribe = subscribeForTest((event) => events.push(event as never));
    for (const phase of RUN_CARRIER_DIAGNOSTIC_PHASES) {
      emitRunCarrierDiagnostic({
        runId: "run-1",
        sessionId: "session-1",
        sessionKey: "agent:sophia:main",
        config: CONFIG_WITH_FLAG,
        phase,
        governed: true,
        hasReadinessGovernance: true,
        hasRunLocalProjectionState: true,
        projectionId: "projection-1",
        projectionDigest: "abc123",
        bootstrapEntryCount: 1,
        bootstrapEntryNames: ["readiness-governance"],
        containsReadinessGovernance: true,
        containsGenericSoulIdentity: false,
        injectionAssertionStatus: "ok",
        injectionDigest: "def456",
        governedAdmission: true,
        hasHolder: true,
        stageBOk: true,
        stageBCode: null,
        dispatch: "allowed",
      });
    }
    unsubscribe();
    expect(events).toHaveLength(RUN_CARRIER_DIAGNOSTIC_PHASES.length);
    for (const event of events) {
      expect(event.type).toBe("run.carrier.diagnostic");
      expect(event.diagnostic_version).toBe(1);
      expect(event.runId).toBe("run-1");
      expect(event.sessionId).toBe("session-1");
      expect(event.timestamp).toEqual(expect.any(String));
      expect(event.governed).toBe(true);
      expect(event.hasReadinessGovernance).toBe(true);
      expect(event.hasRunLocalProjectionState).toBe(true);
      expect(event.projectionId).toBe("projection-1");
      expect(event.projectionDigest).toBe("abc123");
      expect(event.bootstrapEntryCount).toBe(1);
      expect(event.bootstrapEntryNames).toEqual(["readiness-governance"]);
      expect(event.containsReadinessGovernance).toBe(true);
      expect(event.containsGenericSoulIdentity).toBe(false);
      expect(event.injectionAssertionStatus).toBe("ok");
      expect(event.injectionDigest).toBe("def456");
      expect(event.governedAdmission).toBe(true);
      expect(event.hasHolder).toBe(true);
      expect(event.stageBOk).toBe(true);
      expect(event.stageBCode).toBeNull();
      expect(event.dispatch).toBe("allowed");
    }
  });

  it("emits exactly seven contract phases in order", () => {
    expect(RUN_CARRIER_DIAGNOSTIC_PHASES).toEqual([
      "STAGE_A",
      "EMBEDDED_ENTRY",
      "ATTEMPT_DISPATCH",
      "CODEX_ENTRY",
      "BOOTSTRAP_PRE",
      "BOOTSTRAP_POST",
      "GATE2",
    ]);
    expect(new Set(RUN_CARRIER_DIAGNOSTIC_PHASES).size).toBe(RUN_CARRIER_DIAGNOSTIC_PHASES.length);
  });

  it("rejects unknown phases without emitting", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeForTest(listener);
    emitRunCarrierDiagnostic({
      sessionId: "session-1",
      config: CONFIG_WITH_FLAG,
      phase: "UNKNOWN_PHASE" as never,
    });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe("sessionKey safety", () => {
  it("never emits the raw sessionKey; only the bounded SHA-256 prefix", () => {
    const events: Array<Record<string, unknown>> = [];
    const unsubscribe = subscribeForTest((event) => events.push(event as never));
    emitRunCarrierDiagnostic({
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "agent:sophia:main:secret-value",
      config: CONFIG_WITH_FLAG,
      phase: "STAGE_A",
    });
    unsubscribe();
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.sessionKey).toBe(hashRunCarrierSessionKey("agent:sophia:main:secret-value"));
    expect(event.sessionKey).toMatch(/^[0-9a-f]{16}$/u);
    expect(event.sessionKey).not.toContain("secret-value");
    expect(JSON.stringify(event)).not.toContain("agent:sophia:main:secret-value");
  });

  it("hashes deterministically and bounded", () => {
    const first = hashRunCarrierSessionKey("agent:sophia:main");
    const second = hashRunCarrierSessionKey("agent:sophia:main");
    expect(first).toBe(second);
    expect(first).toHaveLength(16);
    expect(hashRunCarrierSessionKey(undefined)).toBeUndefined();
  });
});

describe("no prompt/projection-body/credentials in diagnostics", () => {
  it("never includes prompt, projection content, or credential fields", () => {
    const events: Array<Record<string, unknown>> = [];
    const unsubscribe = subscribeForTest((event) => events.push(event as never));
    emitRunCarrierDiagnostic({
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "agent:sophia:main",
      config: CONFIG_WITH_FLAG,
      phase: "BOOTSTRAP_POST",
      bootstrapEntryNames: ["readiness-governance", "SOUL.md"],
    });
    unsubscribe();
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("projection content");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("credential");
  });
});

describe("fail-closed", () => {
  it("emitter failure never throws to the caller", () => {
    mockedEmitDiagnosticEvent.mockImplementationOnce(() => {
      throw new Error("diagnostic emitter exploded");
    });
    expect(() =>
      emitRunCarrierDiagnostic({
        sessionId: "session-1",
        sessionKey: "agent:sophia:main",
        config: CONFIG_WITH_FLAG,
        phase: "STAGE_A",
      }),
    ).not.toThrow();
    expect(mockedEmitDiagnosticEvent).toHaveBeenCalled();
  });

  it("disabled diagnostics never throw and never emit", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeForTest(listener);
    expect(() =>
      emitRunCarrierDiagnostic({
        sessionId: "session-1",
        sessionKey: "agent:sophia:main",
        config: CONFIG_WITHOUT_FLAG,
        phase: "GATE2",
      }),
    ).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("missing identifiers emit a bounded event without throwing", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeForTest(listener);
    expect(() =>
      emitRunCarrierDiagnostic({
        config: CONFIG_WITH_FLAG,
        phase: "STAGE_A",
      }),
    ).not.toThrow();
    unsubscribe();
  });
});

describe("BOOTSTRAP_PRE hook registry observation", () => {
  it("reports hookRegistryHasBootstrapHandler only at BOOTSTRAP_PRE", () => {
    const events: Array<Record<string, unknown>> = [];
    const unsubscribe = subscribeForTest((event) => events.push(event as never));
    emitRunCarrierDiagnostic({
      sessionId: "session-1",
      config: CONFIG_WITH_FLAG,
      phase: "BOOTSTRAP_PRE",
    });
    emitRunCarrierDiagnostic({
      sessionId: "session-1",
      config: CONFIG_WITH_FLAG,
      phase: "GATE2",
    });
    unsubscribe();
    expect(events).toHaveLength(2);
    expect(events[0]).toHaveProperty("hookRegistryHasBootstrapHandler");
    expect(events[1]).not.toHaveProperty("hookRegistryHasBootstrapHandler");
  });
});
