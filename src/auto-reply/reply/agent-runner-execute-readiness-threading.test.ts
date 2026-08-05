import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalReadinessEnvelopeLoadResult } from "../../agents/readiness/envelope-parser.js";
import type { ReadinessGovernance } from "../../agents/readiness/types.js";
import { SILENT_REPLY_TOKEN } from "../tokens.js";
import type { AgentTurnParams } from "./agent-runner-execution.types.js";

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  loadCanonicalReadinessEnvelope: vi.fn(),
  createReadinessProjectionLoader: vi.fn(),
  prepareReadinessForRun: vi.fn(),
  runMemoryFlushIfNeeded: vi.fn(),
  runPreflightCompactionIfNeeded: vi.fn(),
}));

vi.mock("./agent-runner-execution.js", () => ({
  executeAgentTurn: (...args: unknown[]) => state.execute(...args),
}));

vi.mock("../../agents/readiness/canonical-envelope-reader.js", () => ({
  loadCanonicalReadinessEnvelope: (...args: unknown[]) =>
    state.loadCanonicalReadinessEnvelope(...args),
}));

vi.mock("../../agents/readiness/projection-loader.js", () => ({
  createReadinessProjectionLoader: (...args: unknown[]) =>
    state.createReadinessProjectionLoader(...args),
}));

vi.mock("../../agents/readiness/run-preparation.js", () => ({
  prepareReadinessForRun: (...args: unknown[]) => state.prepareReadinessForRun(...args),
}));

vi.mock("./agent-runner-memory.js", () => ({
  runMemoryFlushIfNeeded: (...args: unknown[]) => state.runMemoryFlushIfNeeded(...args),
  runPreflightCompactionIfNeeded: (...args: unknown[]) =>
    state.runPreflightCompactionIfNeeded(...args),
}));

const { executePreparedReplyAgentRun } = await import("./agent-runner-execute.js");

function makeReadyEnvelope(): CanonicalReadinessEnvelopeLoadResult {
  return {
    ok: true,
    envelope: {
      envelopeVersion: "readiness-envelope.v1",
      publishedAt: "2026-08-04T12:00:00.000Z",
      publishedBy: "test",
      evidence: {
        contract_version: "readiness.v1",
        decision: "READY",
        valid_until: "2026-08-05T12:00:00.000Z",
        evaluated_at: "2026-08-04T12:00:00.000Z",
        projection_id: "proj-v1",
        projection_version: "1.0.0",
      },
      projection: { id: "proj-v1", version: "1.0.0", content: "test content" },
      binding: { kind: "sha256", projectionSha256: "a".repeat(64) },
    },
    evidenceJson: JSON.stringify({ decision: "READY" }),
    projection: { id: "proj-v1", version: "1.0.0", content: "test content" },
  };
}

function makeGovernedReady(): ReadinessGovernance {
  return {
    governed: true,
    state: {
      mayExecute: () => true,
      isBlocked: () => false,
      classification: "ready",
      diagnosticRef: "test",
      evaluatedAt: Date.now(),
      toBlockedResult: () => ({
        isBlocked: false,
        classification: "ready",
        diagnosticRef: "test",
        evaluatedAt: Date.now(),
        sanitizedMessage: "",
      }),
    } as never,
  };
}

function makeGovernedBlocked(): ReadinessGovernance {
  return {
    governed: true,
    state: {
      mayExecute: () => false,
      isBlocked: () => true,
      classification: "blocked",
      diagnosticRef: "test",
      evaluatedAt: Date.now(),
      toBlockedResult: () => ({
        isBlocked: true,
        classification: "blocked",
        diagnosticRef: "test",
        evaluatedAt: Date.now(),
        sanitizedMessage: "blocked",
      }),
    } as never,
  };
}

function createMinimalContext(): Parameters<typeof executePreparedReplyAgentRun>[0] {
  return {
    followupRun: {
      prompt: "hello",
      transcriptPrompt: "hello",
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
    commandBody: "hello",
    sessionCtx: { Provider: "slack", MessageSid: "msg" } as never,
    opts: {},
    typingSignals: {
      signalRunStart: vi.fn(async () => {}),
      signalMessageStart: vi.fn(async () => {}),
      signalTextDelta: vi.fn(async () => {}),
      signalReasoningDelta: vi.fn(async () => {}),
      signalToolStart: vi.fn(async () => {}),
      signalExecutionActivity: vi.fn(async () => {}),
    },
    blockReplyPipeline: null,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end" as const,
    applyReplyToMode: (p: never) => p,
    shouldEmitToolResult: () => true,
    shouldEmitToolOutput: () => false,
    pendingToolTasks: new Set(),
    resetSessionAfterRoleOrderingConflict: async () => false,
    isHeartbeat: false,
    sessionKey: "main",
    getActiveSessionEntry: () => undefined,
    activeSessionStore: undefined,
    storePath: undefined,
    resolvedVerboseLevel: "off" as const,
    replyOperation: {
      key: "main",
      sessionId: "session",
      abortSignal: new AbortController().signal,
      staleExpiryReason: undefined,
      resetTriggered: false,
      terminalRecovery: false,
      acceptedSteeredInboundAudio: false,
      phase: "running",
      result: null,
      startedAtMs: Date.now(),
      lastActivityAtMs: Date.now(),
      hasOwnedSessionId: vi.fn(() => true),
      recordActivity: vi.fn(),
      setPhase: vi.fn(),
      markWaitingForDeferredMaintenance: vi.fn(),
      markDeferredMaintenanceWaitEnded: vi.fn(),
      markWaitingForGlobalLane: vi.fn(),
      markGlobalLaneWaitEnded: vi.fn(),
      updateSessionId: vi.fn(),
      updateSessionKey: vi.fn(),
      attachBackend: vi.fn(),
      detachBackend: vi.fn(),
      freezeAbort: vi.fn(),
      retainFailureUntilComplete: vi.fn(),
      complete: vi.fn(),
      completeThen: vi.fn((afterClear: () => void) => afterClear()),
      completeWithAfterClearBarrier: vi.fn(),
      fail: vi.fn(),
      abortByUser: vi.fn(() => true),
      abortForRestart: vi.fn(() => true),
      markTerminalRecovery: vi.fn(),
      markAcceptedSteeredInboundAudio: vi.fn(),
    } as never,
    replyMediaContext: undefined as never,
    confirmRestartRecoveryArmedAfterLeaseLoss: undefined,
    isRestartRecoveryArmed: undefined,
    admitUserTurn: vi.fn(async () => undefined),
    agentCfgContextTokens: undefined,
    beforeAgentReplyDispatchedForSteer: false,
    beginBeforeAgentReply: vi.fn(async () => true),
    checkpointBeforeAgentReply: vi.fn(async () => {}),
    cfg: {} as never,
    defaultModel: "claude",
    getActiveIsNewSession: () => false,
    performSessionReset: async () => false,
    queueKey: "main",
    replyRouteThreadId: undefined,
    replyThreadingOverride: undefined,
    replyToChannel: undefined,
    replyToMode: undefined,
    resolvedQueue: undefined,
    returnWithQueuedFollowupDrain: (v: never) => v,
    runFollowupTurn: undefined as never,
    runtimePolicySessionKey: undefined,
    sendDirectCompactionNotice: undefined,
    setActiveSessionEntry: vi.fn(),
    setRunFollowupTurn: vi.fn(),
    shouldInjectGroupIntro: false,
    toolProgressDetail: undefined,
    traceAgentPhase: (_name: string, run: () => unknown) => run(),
    turnAdoptionLifecycle: undefined,
    typing: undefined,
    typingMode: "instant" as const,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.loadCanonicalReadinessEnvelope.mockReturnValue(makeReadyEnvelope());
  state.createReadinessProjectionLoader.mockReturnValue(async () => ({
    ok: true,
    projection: { id: "proj-v1", version: "1.0.0", content: "test content" },
  }));
  state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedReady() });
  state.execute.mockResolvedValue({
    runId: "run-1",
    outcome: { kind: "rejected", payload: { text: "done" } },
  });
  state.runMemoryFlushIfNeeded.mockResolvedValue({ sessionEntry: undefined, outcome: "completed" });
  state.runPreflightCompactionIfNeeded.mockResolvedValue(undefined);
});

describe("executePreparedReplyAgentRun: direct route readiness threading", () => {
  it("READY canonical reader called once", async () => {
    await executePreparedReplyAgentRun(createMinimalContext());
    expect(state.loadCanonicalReadinessEnvelope).toHaveBeenCalledTimes(1);
  });

  it("READY projection loader called once", async () => {
    await executePreparedReplyAgentRun(createMinimalContext());
    expect(state.createReadinessProjectionLoader).toHaveBeenCalledTimes(1);
  });

  it("READY preparation helper called once", async () => {
    await executePreparedReplyAgentRun(createMinimalContext());
    expect(state.prepareReadinessForRun).toHaveBeenCalledTimes(1);
  });

  it("READY exact governance attached", async () => {
    const governance = makeGovernedReady();
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance });
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance).toBe(governance);
  });

  it("BLOCKED exact governance attached", async () => {
    const governance = makeGovernedBlocked();
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance });
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance).toBe(governance);
  });

  it("reader missing yields governed BLOCKED", async () => {
    state.loadCanonicalReadinessEnvelope.mockReturnValue({
      ok: false,
      code: "EVIDENCE_MISSING",
      message: "not found",
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(true);
    if (call.followupRun.run.readinessGovernance?.governed) {
      expect(call.followupRun.run.readinessGovernance.state.mayExecute()).toBe(false);
    }
  });

  it("malformed reader result yields governed BLOCKED", async () => {
    state.loadCanonicalReadinessEnvelope.mockReturnValue({
      ok: false,
      code: "EVIDENCE_MALFORMED",
      message: "invalid",
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(true);
    if (call.followupRun.run.readinessGovernance?.governed) {
      expect(call.followupRun.run.readinessGovernance.state.mayExecute()).toBe(false);
    }
  });

  it("sanitized reader failure yields governed BLOCKED", async () => {
    state.loadCanonicalReadinessEnvelope.mockReturnValue({
      ok: false,
      code: "INTERNAL_EVALUATION_FAILURE_SANITIZED",
      message: "internal error",
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(true);
    if (call.followupRun.run.readinessGovernance?.governed) {
      expect(call.followupRun.run.readinessGovernance.state.mayExecute()).toBe(false);
    }
  });

  it("projection loader not called on reader failure", async () => {
    state.loadCanonicalReadinessEnvelope.mockReturnValue({
      ok: false,
      code: "EVIDENCE_MISSING",
      message: "not found",
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    await executePreparedReplyAgentRun(createMinimalContext());
    expect(state.createReadinessProjectionLoader).not.toHaveBeenCalled();
  });

  it("model route never reaches executeAgentTurn with undefined governance", async () => {
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance).toBeDefined();
  });

  it("model route never reaches executeAgentTurn with governed:false", async () => {
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(true);
  });

  it("executeAgentTurn called exactly once", async () => {
    await executePreparedReplyAgentRun(createMinimalContext());
    expect(state.execute).toHaveBeenCalledTimes(1);
  });

  it("readiness preparation occurs after safe preflight", async () => {
    await executePreparedReplyAgentRun(createMinimalContext());
    expect(state.loadCanonicalReadinessEnvelope).toHaveBeenCalledTimes(1);
  });

  it("readiness preparation occurs before executeAgentTurn", async () => {
    const order: string[] = [];
    state.loadCanonicalReadinessEnvelope.mockImplementation(() => {
      order.push("readiness");
      return makeReadyEnvelope();
    });
    state.execute.mockImplementation(() => {
      order.push("execute");
      return { runId: "run-1", outcome: { kind: "rejected", payload: { text: "done" } } };
    });
    await executePreparedReplyAgentRun(createMinimalContext());
    expect(order).toEqual(["readiness", "execute"]);
  });

  it("no real provider/model call", async () => {
    await executePreparedReplyAgentRun(createMinimalContext());
    expect(state.execute).toHaveBeenCalledTimes(1);
  });

  it("no delivery behavior changed", async () => {
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.blockReplyPipeline).toBeNull();
    expect(call.blockStreamingEnabled).toBe(false);
  });

  it("no fallback behavior changed", async () => {
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.provider).toBe("anthropic");
    expect(call.followupRun.run.model).toBe("claude");
  });

  it("followup route remains unchanged", async () => {
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance).toBeDefined();
  });

  it("preparation failure returns silent terminal without calling executeAgentTurn", async () => {
    state.prepareReadinessForRun.mockReturnValue({
      ok: false,
      code: "POLICY_UNRESOLVED",
      message: "unknown policy disposition",
    });
    const result = await executePreparedReplyAgentRun(createMinimalContext());
    expect(state.execute).not.toHaveBeenCalled();
    expect(result).toEqual({ text: SILENT_REPLY_TOKEN });
  });
});
