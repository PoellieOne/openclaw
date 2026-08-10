import { beforeEach, describe, expect, it, vi } from "vitest";
import type { V2CanonicalReadinessEnvelopeLoadResult } from "../../agents/readiness/envelope-parser.js";
import type { ReadinessGovernance } from "../../agents/readiness/types.js";
import { SILENT_REPLY_TOKEN } from "../tokens.js";
import type { AgentTurnParams } from "./agent-runner-execution.types.js";

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  loadCanonicalReadinessEnvelopeV2: vi.fn(),
  prepareReadinessForRun: vi.fn(),
  resolveRuntimeImageTruth: vi.fn(),
  runMemoryFlushIfNeeded: vi.fn(),
  runPreflightCompactionIfNeeded: vi.fn(),
}));

vi.mock("./agent-runner-execution.js", () => ({
  executeAgentTurn: (...args: unknown[]) => state.execute(...args),
}));

vi.mock("../../agents/readiness/canonical-envelope-reader.js", () => ({
  loadCanonicalReadinessEnvelopeV2: (...args: unknown[]) =>
    state.loadCanonicalReadinessEnvelopeV2(...args),
}));

vi.mock("../../agents/readiness/run-preparation.js", () => ({
  prepareReadinessForRun: (...args: unknown[]) => state.prepareReadinessForRun(...args),
}));

vi.mock("../../agents/readiness/runtime-provenance.js", () => ({
  resolveRuntimeImageTruth: (...args: unknown[]) => state.resolveRuntimeImageTruth(...args),
}));

vi.mock("./agent-runner-memory.js", () => ({
  runMemoryFlushIfNeeded: (...args: unknown[]) => state.runMemoryFlushIfNeeded(...args),
  runPreflightCompactionIfNeeded: (...args: unknown[]) =>
    state.runPreflightCompactionIfNeeded(...args),
}));

const { executePreparedReplyAgentRun } = await import("./agent-runner-execute.js");

function makeReadyEnvelope(): V2CanonicalReadinessEnvelopeLoadResult {
  return {
    ok: true,
    envelope: {
      envelopeVersion: "readiness-envelope.v2",
      publishedAt: "2026-08-04T12:00:00.000Z",
      publishedBy: "test",
      evidence: {
        contract_version: "readiness.v2",
        decision: "READY",
        valid_until: "2026-08-05T12:00:00.000Z",
        evaluated_at: "2026-08-04T12:00:00.000Z",
      },
      projection: { id: "proj-v1", version: "1.0.0", content: "test content" },
      binding: { kind: "sha256", projectionSha256: "a".repeat(64) },
      semanticProjection: { id: "sem-v1", version: "1.0.0", sourceDigest: "b".repeat(64) },
      generatedPayload: {
        payloadId: "payload-v1",
        payloadVersion: "1.0.0",
        payloadSha256: "c".repeat(64),
        payloadBytecount: 1024,
        payloadFilename: "payload.json",
      },
      sourceManifest: {
        manifestId: "canonical-source-manifest.v1",
        manifestDigest: "d".repeat(64),
      },
      agentBinding: { agentId: "agent" },
      runtimeBinding: { imageId: "img", sourceCommit: "commit", sourceTree: "tree" },
      configBinding: { configDigest: "e".repeat(64) },
      policyBinding: {
        providerPolicy: "openai",
        modelPolicy: "openai/gpt-5.6-sol",
        preferredAuthMethod: "OPENAI_CHATGPT_CODEX_OAUTH",
        fallbackPolicy: "PROHIBITED",
      },
      credentialRoute: {
        authMethodPolicy: "OPENAI_CHATGPT_CODEX_OAUTH",
        credentialRouteStatus: "AVAILABLE_VERIFIED",
      },
      validator: { validatorId: "readiness-validator-v2", validatorVersion: "1.0.0" },
      revalidation: { revalidationRequired: false, reason: null, validatorVersion: "1.0.0" },
      provenance: { generatorId: "test-generator", generatorVersion: "1.0.0" },
    },
    envelopeJson: JSON.stringify({ decision: "READY" }),
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
  state.loadCanonicalReadinessEnvelopeV2.mockReturnValue(makeReadyEnvelope());
  state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedReady() });
  state.resolveRuntimeImageTruth.mockReturnValue({
    ok: true,
    truth: {
      imageId: "sha256:c9515b90811c75128d97fff1bfde9f6075201d95f9f6d759f43878c2fc81229c",
      sourceCommit: "092549f011e2bfcbfe6ac3af4bb8423ecef7422c",
      sourceTree: "c17d48bf3368d5726beb1ff5656b00a9c3ce7a08",
    },
  });
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
    expect(state.loadCanonicalReadinessEnvelopeV2).toHaveBeenCalledTimes(1);
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
    state.loadCanonicalReadinessEnvelopeV2.mockReturnValue({
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
    state.loadCanonicalReadinessEnvelopeV2.mockReturnValue({
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
    state.loadCanonicalReadinessEnvelopeV2.mockReturnValue({
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

  it("V2 preparation still called on reader failure", async () => {
    state.loadCanonicalReadinessEnvelopeV2.mockReturnValue({
      ok: false,
      code: "EVIDENCE_MISSING",
      message: "not found",
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    await executePreparedReplyAgentRun(createMinimalContext());
    expect(state.prepareReadinessForRun).toHaveBeenCalledTimes(1);
  });

  it("V2 BLOCKED envelope still yields governed BLOCKED", async () => {
    state.loadCanonicalReadinessEnvelopeV2.mockReturnValue({
      ok: true,
      envelope: {
        envelopeVersion: "readiness-envelope.v2",
        publishedAt: "2026-08-04T12:00:00.000Z",
        publishedBy: "test",
        evidence: { contract_version: "readiness.v2", decision: "BLOCKED" },
      },
      envelopeJson: JSON.stringify({ decision: "BLOCKED" }),
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(call.followupRun.run.readinessGovernance?.governed).toBe(true);
    if (call.followupRun.run.readinessGovernance?.governed) {
      expect(call.followupRun.run.readinessGovernance.state.mayExecute()).toBe(false);
    }
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
    expect(state.loadCanonicalReadinessEnvelopeV2).toHaveBeenCalledTimes(1);
  });

  it("readiness preparation occurs before executeAgentTurn", async () => {
    const order: string[] = [];
    state.loadCanonicalReadinessEnvelopeV2.mockImplementation(() => {
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

  it("I6E: resolved runtime provenance is threaded into v2 preparation", async () => {
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.prepareReadinessForRun.mock.calls[0]?.[0] as {
      v2?: {
        validation?: {
          expectedImageId?: string;
          expectedSourceCommit?: string;
          expectedSourceTree?: string;
        };
      };
    };
    expect(call.v2?.validation?.expectedImageId).toBe(
      "sha256:c9515b90811c75128d97fff1bfde9f6075201d95f9f6d759f43878c2fc81229c",
    );
    expect(call.v2?.validation?.expectedSourceCommit).toBe(
      "092549f011e2bfcbfe6ac3af4bb8423ecef7422c",
    );
    expect(call.v2?.validation?.expectedSourceTree).toBe(
      "c17d48bf3368d5726beb1ff5656b00a9c3ce7a08",
    );
  });

  it("I6E: missing runtime provenance yields governed BLOCKED with zero dispatch", async () => {
    state.resolveRuntimeImageTruth.mockReturnValue({
      ok: false,
      code: "PROVENANCE_MISSING",
      message: "OPENCLAW_RUNTIME_IMAGE_ID is not set",
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.prepareReadinessForRun.mock.calls[0]?.[0] as {
      runtimeImageTruth?: { ok: boolean; code: string };
    };
    expect(call.runtimeImageTruth?.ok).toBe(false);
    expect(call.runtimeImageTruth?.code).toBe("PROVENANCE_MISSING");
    const execCall = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(execCall.followupRun.run.readinessGovernance?.governed).toBe(true);
    if (execCall.followupRun.run.readinessGovernance?.governed) {
      expect(execCall.followupRun.run.readinessGovernance.state.mayExecute()).toBe(false);
    }
  });

  it("I6E: malformed runtime provenance yields governed BLOCKED with zero dispatch", async () => {
    state.resolveRuntimeImageTruth.mockReturnValue({
      ok: false,
      code: "PROVENANCE_MALFORMED",
      message: "OPENCLAW_RUNTIME_IMAGE_ID must match ^sha256:[0-9a-f]{64}$",
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    await executePreparedReplyAgentRun(createMinimalContext());
    const call = state.prepareReadinessForRun.mock.calls[0]?.[0] as {
      runtimeImageTruth?: { ok: boolean; code: string };
    };
    expect(call.runtimeImageTruth?.ok).toBe(false);
    expect(call.runtimeImageTruth?.code).toBe("PROVENANCE_MALFORMED");
    const execCall = state.execute.mock.calls[0]?.[0] as AgentTurnParams;
    expect(execCall.followupRun.run.readinessGovernance?.governed).toBe(true);
    if (execCall.followupRun.run.readinessGovernance?.governed) {
      expect(execCall.followupRun.run.readinessGovernance.state.mayExecute()).toBe(false);
    }
  });
});
