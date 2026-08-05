import { describe, expect, it } from "vitest";
import type { AgentTurnExecutionResult } from "./agent-runner-execution.types.js";
import { resolveFollowupDeliveryDecision } from "./followup-delivery.js";
import type { AdmittedFollowupTurn } from "./followup-turn-admission.js";

function createBlockedExecution(): AgentTurnExecutionResult {
  return {
    runId: "run-1",
    outcome: {
      kind: "blocked",
      blockedResult: {
        classification: "POLICY_REQUIRED",
        diagnosticRef: "readiness-blocked",
        evaluatedAt: Date.now(),
        sanitizedMessage: "This action cannot be completed because a readiness check did not pass.",
        isBlocked: true,
      },
      resolved: { provider: "anthropic", model: "claude" },
    },
  };
}

function createSettledExecution(): AgentTurnExecutionResult {
  return {
    runId: "run-1",
    outcome: {
      kind: "settled",
      status: "ok",
      result: { payloads: [{ text: "hello" }], meta: { durationMs: 0 } },
      resolved: { provider: "anthropic", model: "claude" },
      fallback: { exhausted: false, attempts: [] },
      autoCompactionCount: 0,
      didLogHeartbeatStrip: false,
    },
  };
}

function createRejectedExecution(): AgentTurnExecutionResult {
  return {
    runId: "run-1",
    outcome: {
      kind: "rejected",
      payload: { text: "error" },
      resolved: { provider: "anthropic", model: "claude" },
    },
  };
}

function createTurn(): AdmittedFollowupTurn {
  return {
    runId: "run-1",
    queued: {
      prompt: "hello",
      enqueuedAt: Date.now(),
      run: {
        agentId: "agent",
        agentDir: "/tmp/agent",
        sessionId: "session",
        sessionKey: "main",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp",
        config: {},
        provider: "anthropic",
        model: "claude",
        messageProvider: "slack",
        timeoutMs: 1_000,
        blockReplyBreak: "message_end",
      },
    },
    operation: { abortSignal: new AbortController().signal } as AdmittedFollowupTurn["operation"],
    config: {},
    session: {
      kind: "session",
      key: "main",
      current: () => ({ sessionId: "session", updatedAt: 1 }),
      publish: () => undefined,
      adopt: () => undefined,
    },
    sendPolicy: "allow",
    preflightCompactionApplied: false,
  };
}

describe("resolveFollowupDeliveryDecision: blocked result", () => {
  it("BLOCKED maps to explicit suppression", () => {
    const turn = createTurn();
    const execution = createBlockedExecution();
    const decision = resolveFollowupDeliveryDecision({ turn, execution });
    expect(decision.kind).toBe("suppress");
    if (decision.kind === "suppress") {
      expect(decision.reason).toBe("blocked");
    }
  });

  it("suppression contains no reply payload", () => {
    const turn = createTurn();
    const execution = createBlockedExecution();
    const decision = resolveFollowupDeliveryDecision({ turn, execution });
    expect(decision.kind).toBe("suppress");
  });

  it("suppression contains no provider/model metadata", () => {
    const turn = createTurn();
    const execution = createBlockedExecution();
    const decision = resolveFollowupDeliveryDecision({ turn, execution });
    expect(decision.kind).toBe("suppress");
  });

  it("sanitizedMessage is not delivered", () => {
    const turn = createTurn();
    const execution = createBlockedExecution();
    const decision = resolveFollowupDeliveryDecision({ turn, execution });
    expect(decision.kind).toBe("suppress");
  });

  it("classification/diagnosticRef are not delivered", () => {
    const turn = createTurn();
    const execution = createBlockedExecution();
    const decision = resolveFollowupDeliveryDecision({ turn, execution });
    expect(decision.kind).toBe("suppress");
  });

  it("interactive followup BLOCKED is suppressed", () => {
    const turn = createTurn();
    turn.queued.run.inputProvenance = { kind: "external_user" } as never;
    const execution = createBlockedExecution();
    const decision = resolveFollowupDeliveryDecision({ turn, execution });
    expect(decision.kind).toBe("suppress");
  });

  it("non-interactive followup BLOCKED is suppressed", () => {
    const turn = createTurn();
    const execution = createBlockedExecution();
    const decision = resolveFollowupDeliveryDecision({ turn, execution });
    expect(decision.kind).toBe("suppress");
  });

  it("settled behavior remains unchanged", () => {
    const turn = createTurn();
    const execution = createSettledExecution();
    const decision = resolveFollowupDeliveryDecision({ turn, execution });
    expect(decision.kind).toBe("suppress");
  });

  it("existing non-BLOCKED suppression behavior remains unchanged", () => {
    const turn = createTurn();
    turn.sendPolicy = "deny";
    const execution = createBlockedExecution();
    const decision = resolveFollowupDeliveryDecision({ turn, execution });
    expect(decision.kind).toBe("suppress");
    if (decision.kind === "suppress") {
      expect(decision.reason).toBe("send-policy");
    }
  });

  it("rejected behavior remains unchanged", () => {
    const turn = createTurn();
    const execution = createRejectedExecution();
    const decision = resolveFollowupDeliveryDecision({ turn, execution });
    expect(decision.kind).toBe("suppress");
  });
});
