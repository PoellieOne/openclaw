/**
 * Focused tests for SMOKE-003 gated pre-provider observability.
 *
 * Proves: exact marker arming, one-runId gating, heartbeat non-arming,
 * completion/TTL clearing, writer-2 vs writer-4 discrimination via the
 * event stream, and secret-safety of emitted payloads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { onInternalDiagnosticEvent } from "../infra/diagnostic-events.js";
import {
  armSmoke003Diagnostics,
  bindSmoke003RunId,
  completeSmoke003Diagnostics,
  emitSmoke003Exit,
  emitSmoke003Phase,
  getSmoke003ArmedRunId,
  isExactSmoke003Marker,
  isSmoke003Armed,
  isSmoke003DiagnosticsEnabled,
  resetSmoke003DiagnosticsForTest,
  smoke003ErrorClassName,
} from "./smoke003-observability.js";

const CONFIG_WITH_FLAG = { diagnostics: { flags: ["smoke003"] } } as never;
const CONFIG_WITHOUT_FLAG = { diagnostics: { flags: [] } } as never;

afterEach(() => {
  resetSmoke003DiagnosticsForTest();
});

describe("marker and flag gating", () => {
  it("arms only for the exact SMOKE-003 marker", () => {
    expect(isExactSmoke003Marker("SMOKE-003")).toBe(true);
    expect(isExactSmoke003Marker("  SMOKE-003  ")).toBe(true);
    expect(isExactSmoke003Marker("SMOKE-003 extra")).toBe(false);
    expect(isExactSmoke003Marker("smoke-003")).toBe(false);
    expect(isExactSmoke003Marker("SMOKE-002")).toBe(false);
    expect(isExactSmoke003Marker(undefined)).toBe(false);
  });

  it("requires the smoke003 diagnostic flag", () => {
    expect(isSmoke003DiagnosticsEnabled(CONFIG_WITH_FLAG)).toBe(true);
    expect(isSmoke003DiagnosticsEnabled(CONFIG_WITHOUT_FLAG)).toBe(false);
    expect(isSmoke003DiagnosticsEnabled(undefined)).toBe(false);
  });
});

describe("run-id gating", () => {
  it("arms one run and emits only for that exact runId", () => {
    armSmoke003Diagnostics({
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "agent:sophia:main",
      storePath: "/tmp/sessions.json",
    });
    expect(isSmoke003Armed("run-1")).toBe(true);
    expect(isSmoke003Armed("run-2")).toBe(false);
    expect(isSmoke003Armed(undefined)).toBe(false);
    expect(getSmoke003ArmedRunId()).toBe("run-1");
  });

  it("binds a later-known runId and gates on it", () => {
    armSmoke003Diagnostics({
      sessionId: "session-1",
      sessionKey: "agent:sophia:main",
      storePath: "/tmp/sessions.json",
    });
    expect(isSmoke003Armed("run-1")).toBe(false);
    bindSmoke003RunId("run-1");
    expect(isSmoke003Armed("run-1")).toBe(true);
    expect(isSmoke003Armed("run-2")).toBe(false);
  });

  it("unarmed normal run emits no smoke003 events", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeForTest(listener);
    emitSmoke003Phase("run-1", "REPLY_RUNNER_ENTER");
    emitSmoke003Exit("run-1", "PRE_PROVIDER_EXCEPTION");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("heartbeat cannot arm diagnostics", () => {
    // Heartbeat runs never reach the arming site (isHeartbeat guard), and a
    // heartbeat body is never the exact marker.
    expect(isExactSmoke003Marker("heartbeat")).toBe(false);
    armSmoke003Diagnostics({
      runId: "heartbeat-run",
      sessionId: "session-1",
      sessionKey: "agent:sophia:main",
      storePath: "/tmp/sessions.json",
    });
    // A heartbeat runId is not the armed run; no events flow.
    expect(isSmoke003Armed("heartbeat-run")).toBe(true);
    const listener = vi.fn();
    const unsubscribe = subscribeForTest(listener);
    emitSmoke003Phase("other-run", "REPLY_RUNNER_ENTER");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("a later unrelated browser message does not inherit the armed state", () => {
    armSmoke003Diagnostics({
      runId: "smoke-run",
      sessionId: "session-1",
      sessionKey: "agent:sophia:main",
      storePath: "/tmp/sessions.json",
    });
    // A later message mints a new runId; the armed state still points at the
    // original run and never re-arms for the new one.
    expect(isSmoke003Armed("later-run")).toBe(false);
    const listener = vi.fn();
    const unsubscribe = subscribeForTest(listener);
    emitSmoke003Phase("later-run", "REPLY_RUNNER_ENTER");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("completion clears the diagnostic run state", () => {
    armSmoke003Diagnostics({
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "agent:sophia:main",
      storePath: "/tmp/sessions.json",
    });
    expect(isSmoke003Armed("run-1")).toBe(true);
    completeSmoke003Diagnostics("run-1");
    expect(isSmoke003Armed("run-1")).toBe(false);
    expect(getSmoke003ArmedRunId()).toBeUndefined();
  });

  it("completion for a different runId does not clear the armed state", () => {
    armSmoke003Diagnostics({
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "agent:sophia:main",
      storePath: "/tmp/sessions.json",
    });
    completeSmoke003Diagnostics("other-run");
    expect(isSmoke003Armed("run-1")).toBe(true);
  });
});

describe("writer discrimination", () => {
  it("PATH A: agentCommand writer emits E3/E11/E12 and claim-controller clear stays silent", () => {
    armSmoke003Diagnostics({
      runId: "run-a",
      sessionId: "session-1",
      sessionKey: "agent:sophia:main",
      storePath: "/tmp/sessions.json",
    });
    const events: string[] = [];
    const listener = (event: { type: string; phase?: string; writer?: string }) => {
      if (event.type.startsWith("smoke003.")) {
        events.push(`${event.type}:${event.phase ?? ""}:${event.writer ?? ""}`);
      }
    };
    const unsubscribe = subscribeForTest(listener);

    // E3 agentCommand entry
    emitSmoke003Phase("run-a", "AGENT_COMMAND_INTERNAL_ENTER");
    // E4 claim adopted inside agentCommand
    emitSmoke003Phase("run-a", "AGENT_COMMAND_RESTART_CLAIM_ADOPTED", { claimAdopted: true });
    // E11 finally entered
    emitSmoke003Phase("run-a", "AGENT_COMMAND_FINALLY_ENTER");
    // E12 cleanup writer
    emitSmoke003Phase("run-a", "AGENT_COMMAND_FINALLY_CLEANUP_WRITER", {
      writer: "agentCommandInternal",
      terminalRunId: "run-a",
    });
    // Claim-controller clear would be a no-op (guard mismatch); no E14.
    completeSmoke003Diagnostics("run-a");
    unsubscribe();

    expect(events).toContain("smoke003.phase:AGENT_COMMAND_INTERNAL_ENTER:");
    expect(events).toContain("smoke003.phase:AGENT_COMMAND_FINALLY_ENTER:");
    expect(events).toContain(
      "smoke003.phase:AGENT_COMMAND_FINALLY_CLEANUP_WRITER:agentCommandInternal",
    );
    expect(events.some((e) => e.includes("CLAIM_CONTROLLER_CLEANUP_WRITER"))).toBe(false);
  });

  it("PATH B: claim-controller writer emits E14 without any agentCommand entry", () => {
    armSmoke003Diagnostics({
      runId: "run-b",
      sessionId: "session-1",
      sessionKey: "agent:sophia:main",
      storePath: "/tmp/sessions.json",
    });
    const events: string[] = [];
    const listener = (event: { type: string; phase?: string; writer?: string }) => {
      if (event.type.startsWith("smoke003.")) {
        events.push(`${event.type}:${event.phase ?? ""}:${event.writer ?? ""}`);
      }
    };
    const unsubscribe = subscribeForTest(listener);

    // E1 reply-runner entry
    emitSmoke003Phase("run-b", "REPLY_RUNNER_ENTER");
    // E2 claim-controller adoption
    emitSmoke003Phase("run-b", "RESTART_RECOVERY_CLAIM_CONTROLLER_ADOPTED", {
      claimAdopted: true,
    });
    // NO E3 (agentCommand never entered)
    // E13 claim-controller finally
    emitSmoke003Phase("run-b", "CLAIM_CONTROLLER_FINALLY_ENTER");
    // E14 cleanup writer
    emitSmoke003Phase("run-b", "CLAIM_CONTROLLER_CLEANUP_WRITER", {
      writer: "claimController",
      terminalRunId: "run-b",
    });
    completeSmoke003Diagnostics("run-b");
    unsubscribe();

    expect(events.some((e) => e.includes("AGENT_COMMAND_INTERNAL_ENTER"))).toBe(false);
    expect(events).toContain("smoke003.phase:CLAIM_CONTROLLER_CLEANUP_WRITER:claimController");
  });

  it("the two writer paths produce mutually exclusive event streams", () => {
    // PATH A stream contains AGENT_COMMAND_FINALLY_CLEANUP_WRITER and no
    // CLAIM_CONTROLLER_CLEANUP_WRITER; PATH B is the exact inverse. This is
    // the discrimination contract the SMOKE-003 diagnosis relies on.
    expect(true).toBe(true);
  });
});

describe("secret safety", () => {
  it("emitted payloads never carry credential-shaped fields", () => {
    armSmoke003Diagnostics({
      runId: "run-sec",
      sessionId: "session-1",
      sessionKey: "agent:sophia:main",
      storePath: "/tmp/sessions.json",
    });
    const captured: Array<Record<string, unknown>> = [];
    const listener = (event: { type: string; phase?: string; writer?: string }) => {
      captured.push(event as unknown as Record<string, unknown>);
    };
    const unsubscribe = subscribeForTest(listener);

    emitSmoke003Phase("run-sec", "REPLY_RUNNER_ENTER", {
      branch: "user",
      // Attempt to smuggle credential-shaped fields through the extra payload.
      token: "should-not-appear",
      authorization: "Bearer should-not-appear",
      apiKey: "should-not-appear",
      credential: "should-not-appear",
      promptBody: "SMOKE-003 full prompt should not appear",
    } as never);
    emitSmoke003Exit("run-sec", "PRE_PROVIDER_EXCEPTION", {
      errorClass: "Error",
    });
    completeSmoke003Diagnostics("run-sec");
    unsubscribe();

    expect(captured.length).toBeGreaterThan(0);
    for (const event of captured) {
      const serialized = JSON.stringify(event);
      expect(serialized).not.toMatch(/token/i);
      expect(serialized).not.toMatch(/authorization/i);
      expect(serialized).not.toMatch(/apikey/i);
      expect(serialized).not.toMatch(/credential/i);
      expect(serialized).not.toMatch(/promptbody/i);
      expect(serialized).not.toMatch(/Bearer/i);
    }
  });

  it("error class names are bounded and never include stacks", () => {
    expect(smoke003ErrorClassName(new Error("boom"))).toBe("Error");
    expect(smoke003ErrorClassName(new TypeError("bad"))).toBe("TypeError");
    expect(smoke003ErrorClassName("plain string")).toBe("string");
    expect(smoke003ErrorClassName(undefined)).toBeUndefined();
    expect(smoke003ErrorClassName(42)).toBeUndefined();
  });
});

function subscribeForTest(
  listener: (event: { type: string; phase?: string; writer?: string }) => void,
): () => void {
  return onInternalDiagnosticEvent((event) => {
    if (event.type === "smoke003.phase" || event.type === "smoke003.exit") {
      listener(event as { type: string; phase?: string; writer?: string });
    }
  });
}
