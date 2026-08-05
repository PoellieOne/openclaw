import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalReadinessEnvelopeLoadResult } from "../../agents/readiness/envelope-parser.js";
import type { ReadinessGovernance } from "../../agents/readiness/types.js";
import type { AgentTurnParams } from "./agent-runner-execution.types.js";
import type { AdmittedFollowupTurn } from "./followup-turn-admission.js";

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  loadEntryReadOnly: vi.fn(),
  reset: vi.fn(),
  loadCanonicalReadinessEnvelope: vi.fn(),
  createReadinessProjectionLoader: vi.fn(),
  prepareReadinessForRun: vi.fn(),
}));

vi.mock("./agent-runner-execution.js", () => ({
  executeAgentTurn: (...args: unknown[]) => state.execute(...args),
}));

vi.mock("./agent-runner-session-reset.js", () => ({
  resetReplyRunSession: (...args: unknown[]) => state.reset(...args),
}));

vi.mock("../../config/sessions/session-accessor.js", () => ({
  loadSessionEntryReadOnly: (...args: unknown[]) => state.loadEntryReadOnly(...args),
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

const { executeFollowupTurn } = await import("./followup-turn-execution.js");

function createTypingController() {
  return {
    onReplyStart: vi.fn(async () => {}),
    startTypingLoop: vi.fn(async () => {}),
    startTypingOnText: vi.fn(async () => {}),
    refreshTypingTtl: vi.fn(),
    isActive: vi.fn(() => false),
    markRunComplete: vi.fn(),
    markDispatchIdle: vi.fn(),
    cleanup: vi.fn(),
  };
}

function createTurn(overrides: Partial<AdmittedFollowupTurn> = {}): AdmittedFollowupTurn {
  return {
    runId: "run-1",
    queued: {
      prompt: "queued prompt",
      transcriptPrompt: "queued transcript",
      enqueuedAt: 1,
      messageId: "message-1",
      originatingChannel: "discord",
      originatingTo: "channel:C1",
      originatingThreadId: "thread-1",
      originatingAccountId: "acct-1",
      originatingChatType: "group",
      media: [{ kind: "audio", contentType: "audio/ogg" }],
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
        senderId: "user-1",
        timeoutMs: 1_000,
        blockReplyBreak: "message_end",
      },
    },
    operation: { abortSignal: new AbortController().signal } as AdmittedFollowupTurn["operation"],
    config: {},
    session: {
      kind: "session",
      key: "main",
      current: () => ({ sessionId: "session", updatedAt: 1, verboseLevel: "on" }),
      publish: () => undefined,
      adopt: () => undefined,
    },
    sendPolicy: "allow",
    preflightCompactionApplied: false,
    ...overrides,
  };
}

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

function makeBlockedEnvelope(): CanonicalReadinessEnvelopeLoadResult {
  return {
    ok: true,
    envelope: {
      envelopeVersion: "readiness-envelope.v1",
      publishedAt: "2026-08-04T12:00:00.000Z",
      publishedBy: "test",
      evidence: {
        contract_version: "readiness.v1",
        decision: "BLOCKED",
      },
    },
    evidenceJson: JSON.stringify({ decision: "BLOCKED" }),
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

beforeEach(() => {
  vi.clearAllMocks();
  state.loadEntryReadOnly.mockReturnValue(undefined);
  state.execute.mockResolvedValue({
    runId: "run-1",
    outcome: { kind: "rejected", payload: { text: "done" } },
  });
  state.loadCanonicalReadinessEnvelope.mockReturnValue(makeReadyEnvelope());
  state.createReadinessProjectionLoader.mockReturnValue(async () => ({
    ok: true,
    projection: { id: "proj-v1", version: "1.0.0", content: "test content" },
  }));
  state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedReady() });
});

describe("executeFollowupTurn: upstream readiness threading", () => {
  it("real model READY loads canonical evidence once", async () => {
    const turn = createTurn();
    const typing = createTypingController();

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    expect(state.loadCanonicalReadinessEnvelope).toHaveBeenCalledTimes(1);
  });

  it("real model READY prepares governance once", async () => {
    const turn = createTurn();
    const typing = createTypingController();

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    expect(state.prepareReadinessForRun).toHaveBeenCalledTimes(1);
  });

  it("real model READY passes exact governance to executeAgentTurn", async () => {
    const turn = createTurn();
    const typing = createTypingController();
    const governance = makeGovernedReady();
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance });

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance).toBe(governance);
  });

  it("canonical BLOCKED produces governed BLOCKED", async () => {
    const turn = createTurn();
    const typing = createTypingController();
    state.loadCanonicalReadinessEnvelope.mockReturnValue(makeBlockedEnvelope());
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(true);
    if (call.followupRun.run.readinessGovernance?.governed) {
      expect(call.followupRun.run.readinessGovernance.state.mayExecute()).toBe(false);
    }
  });

  it("missing canonical evidence produces governed BLOCKED", async () => {
    const turn = createTurn();
    const typing = createTypingController();
    state.loadCanonicalReadinessEnvelope.mockReturnValue({
      ok: false,
      code: "EVIDENCE_MISSING",
      message: "not found",
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(true);
    if (call.followupRun.run.readinessGovernance?.governed) {
      expect(call.followupRun.run.readinessGovernance.state.mayExecute()).toBe(false);
    }
  });

  it("malformed evidence produces governed BLOCKED", async () => {
    const turn = createTurn();
    const typing = createTypingController();
    state.loadCanonicalReadinessEnvelope.mockReturnValue({
      ok: false,
      code: "EVIDENCE_MALFORMED",
      message: "invalid",
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(true);
    if (call.followupRun.run.readinessGovernance?.governed) {
      expect(call.followupRun.run.readinessGovernance.state.mayExecute()).toBe(false);
    }
  });

  it("expired evidence produces governed BLOCKED", async () => {
    const turn = createTurn();
    const typing = createTypingController();
    state.loadCanonicalReadinessEnvelope.mockReturnValue(makeReadyEnvelope());
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(true);
    if (call.followupRun.run.readinessGovernance?.governed) {
      expect(call.followupRun.run.readinessGovernance.state.mayExecute()).toBe(false);
    }
  });

  it("projection mismatch produces governed BLOCKED", async () => {
    const turn = createTurn();
    const typing = createTypingController();
    state.loadCanonicalReadinessEnvelope.mockReturnValue(makeReadyEnvelope());
    state.createReadinessProjectionLoader.mockReturnValue(async () => ({
      ok: false,
      code: "PROJECTION_BINDING_MISMATCH",
      message: "mismatch",
    }));
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(true);
    if (call.followupRun.run.readinessGovernance?.governed) {
      expect(call.followupRun.run.readinessGovernance.state.mayExecute()).toBe(false);
    }
  });

  it("unresolved model-route policy produces governed BLOCKED", async () => {
    const turn = createTurn();
    const typing = createTypingController();
    state.loadCanonicalReadinessEnvelope.mockReturnValue({
      ok: false,
      code: "POLICY_UNRESOLVED",
      message: "unresolved",
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(true);
    if (call.followupRun.run.readinessGovernance?.governed) {
      expect(call.followupRun.run.readinessGovernance.state.mayExecute()).toBe(false);
    }
  });

  it("reader or preparation exception is sanitized and BLOCKED", async () => {
    const turn = createTurn();
    const typing = createTypingController();
    state.loadCanonicalReadinessEnvelope.mockReturnValue({
      ok: false,
      code: "INTERNAL_EVALUATION_FAILURE_SANITIZED",
      message: "internal error",
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(true);
    if (call.followupRun.run.readinessGovernance?.governed) {
      expect(call.followupRun.run.readinessGovernance.state.mayExecute()).toBe(false);
    }
  });

  it("real model route never calls executeAgentTurn with undefined governance", async () => {
    const turn = createTurn();
    const typing = createTypingController();

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance).toBeDefined();
  });

  it("real model route never calls executeAgentTurn with governed:false", async () => {
    const turn = createTurn();
    const typing = createTypingController();

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(true);
  });

  it("trusted non-model route carries explicit governed:false", async () => {
    const turn = createTurn();
    const typing = createTypingController();
    state.prepareReadinessForRun.mockReturnValue({
      ok: true,
      governance: { governed: false, reason: "TRUSTED_NON_MODEL_ROUTE" },
    });

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(false);
  });

  it("canonical reader call count is exactly 1", async () => {
    const turn = createTurn();
    const typing = createTypingController();

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    expect(state.loadCanonicalReadinessEnvelope).toHaveBeenCalledTimes(1);
  });

  it("projection-loader creation count is exactly 1", async () => {
    const turn = createTurn();
    const typing = createTypingController();

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    expect(state.createReadinessProjectionLoader).toHaveBeenCalledTimes(1);
  });

  it("readiness-preparation count is exactly 1", async () => {
    const turn = createTurn();
    const typing = createTypingController();

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    expect(state.prepareReadinessForRun).toHaveBeenCalledTimes(1);
  });

  it("no real provider/model call", async () => {
    const turn = createTurn();
    const typing = createTypingController();

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    expect(state.execute).toHaveBeenCalledTimes(1);
  });

  it("no delivery behavior changed", async () => {
    const turn = createTurn();
    const typing = createTypingController();

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.blockReplyPipeline).toBeNull();
    expect(call.blockStreamingEnabled).toBe(false);
  });

  it("no fallback behavior changed", async () => {
    const turn = createTurn();
    const typing = createTypingController();

    await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });

    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.provider).toBe("anthropic");
    expect(call.followupRun.run.model).toBe("claude");
  });

  it("preparation failure returns typed BLOCKED without calling executeAgentTurn", async () => {
    state.prepareReadinessForRun.mockReturnValue({
      ok: false,
      code: "POLICY_UNRESOLVED",
      message: "unknown policy disposition",
    });
    const turn = createTurn();
    const typing = createTypingController();
    const result = await executeFollowupTurn({
      turn,
      defaults: { typing, typingMode: "instant", defaultModel: "claude", opts: {} },
      onExecutionStarted: vi.fn(),
      onToolResult: vi.fn(async () => {}),
      onCompactionNoticePayload: vi.fn(async () => {}),
    });
    expect(state.execute).not.toHaveBeenCalled();
    expect(result.execution.outcome.kind).toBe("blocked");
    if (result.execution.outcome.kind === "blocked") {
      expect(result.execution.outcome.blockedResult.classification).toBe("POLICY_UNRESOLVED");
      expect(result.execution.outcome.blockedResult.isBlocked).toBe(true);
      expect(result.execution.outcome.resolved.provider).toBe("anthropic");
      expect(result.execution.outcome.resolved.model).toBe("claude");
    }
  });
});
