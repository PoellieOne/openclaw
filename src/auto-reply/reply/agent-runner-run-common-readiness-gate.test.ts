// Focused suite for the pre-steer common readiness gate.
// Runs through the real runReplyAgent ordering with fresh-evaluation seams
// mocked at the same boundaries as agent-runner-execute-readiness-threading.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testing as cliBackendsTesting } from "../../agents/cli-backends.test-support.js";
import type { V2CanonicalReadinessEnvelopeLoadResult } from "../../agents/readiness/envelope-parser.js";
import type { ReadinessGovernance } from "../../agents/readiness/types.js";
import { clearRuntimeConfigSnapshot } from "../../config/config.js";
import { resetDiagnosticEventsForTest } from "../../infra/diagnostic-events.js";
import { resetSystemEventsForTest } from "../../infra/system-events.js";
import { clearMemoryPluginState } from "../../plugins/memory-state.test-fixtures.js";
import type { TemplateContext } from "../templating.js";
import { SILENT_REPLY_TOKEN } from "../tokens.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { replyRunRegistry } from "./reply-run-registry.js";
import { testing as replyRunRegistryTesting } from "./reply-run-registry.test-support.js";
import { createMockTypingController } from "./test-helpers.js";

const state = vi.hoisted(() => ({
  loadCanonicalReadinessEnvelopeV2: vi.fn(),
  prepareReadinessForRun: vi.fn(),
  resolveRuntimeImageTruth: vi.fn(),
  executeAgentTurn: vi.fn(),
  queueEmbeddedAgentMessageWithOutcomeAsync: vi.fn(),
  runMemoryFlushIfNeeded: vi.fn(),
  runPreflightCompactionIfNeeded: vi.fn(),
  resolveCommandSecretRefsViaGateway: vi.fn(),
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

vi.mock("./agent-runner-execution.js", () => ({
  executeAgentTurn: (...args: unknown[]) => state.executeAgentTurn(...args),
}));

vi.mock("./agent-runner-memory.js", () => ({
  runMemoryFlushIfNeeded: (...args: unknown[]) => state.runMemoryFlushIfNeeded(...args),
  runPreflightCompactionIfNeeded: (...args: unknown[]) =>
    state.runPreflightCompactionIfNeeded(...args),
}));

vi.mock("../../agents/embedded-agent-runner/runs.js", () => ({
  queueEmbeddedAgentMessageWithOutcomeAsync: (...args: unknown[]) =>
    state.queueEmbeddedAgentMessageWithOutcomeAsync(...args),
  formatEmbeddedAgentQueueFailureSummary: () => "mocked steer failure summary",
}));

vi.mock("../../cli/command-secret-gateway.js", () => ({
  resolveCommandSecretRefsViaGateway: async ({ config }: { config: unknown }) => {
    state.resolveCommandSecretRefsViaGateway(config);
    return { resolvedConfig: config, diagnostics: [] };
  },
}));

vi.mock("../../cli/command-secret-targets.js", () => ({
  getAgentRuntimeCommandSecretTargetIds: () => new Set<string>(),
  getScopedChannelsCommandSecretTargets: () => ({ targetIds: new Set<string>() }),
}));

vi.mock("../../agents/harness/runtime-plugin.js", () => ({
  ensureSelectedAgentHarnessPlugin: async () => undefined,
}));

vi.mock("../../commitments/runtime.js", () => ({
  enqueueCommitmentExtraction: () => false,
}));

vi.mock("./followup-runner.js", () => ({
  createFollowupRunner: () => vi.fn(async () => undefined),
}));

const queueState = vi.hoisted(() => ({
  enqueueFollowupRun: vi.fn(),
  scheduleFollowupDrain: vi.fn(),
  clearSessionQueues: vi.fn(),
  refreshQueuedFollowupSession: vi.fn(),
}));

vi.mock("./queue.js", () => ({
  enqueueFollowupRun: (...args: unknown[]) => queueState.enqueueFollowupRun(...args),
  scheduleFollowupDrain: (...args: unknown[]) => queueState.scheduleFollowupDrain(...args),
  clearSessionQueues: (...args: unknown[]) => queueState.clearSessionQueues(...args),
  refreshQueuedFollowupSession: (...args: unknown[]) =>
    queueState.refreshQueuedFollowupSession(...args),
}));

vi.mock("../../utils/provider-utils.js", () => ({
  isReasoningTagProvider: (provider: string | undefined | null) =>
    provider === "google" || provider === "google-gemini-cli",
}));

const loadCronStoreMock = vi.fn();
vi.mock("../../cron/store.js", () => ({
  loadCronJobsStore: (...args: unknown[]) => loadCronStoreMock(...args),
  loadCronStore: (...args: unknown[]) => loadCronStoreMock(...args),
  resolveCronJobsStorePath: (storePath?: string) => storePath ?? "/tmp/openclaw-cron-store.json",
  resolveCronStorePath: (storePath?: string) => storePath ?? "/tmp/openclaw-cron-store.json",
}));

vi.mock("../../acp/control-plane/manager.js", () => ({
  getAcpSessionManager: () => ({
    resolveSession: () => ({ kind: "none" }),
    cancelSession: async () => {},
  }),
}));

vi.mock("../../agents/subagent-registry.js", () => ({
  getLatestSubagentRunByChildSessionKey: () => null,
  listSubagentRunsForController: () => [],
  markSubagentRunTerminated: () => 0,
}));

import { runReplyAgent } from "./agent-runner.js";

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

function makeReadyDefaults(): void {
  state.loadCanonicalReadinessEnvelopeV2.mockReturnValue(makeReadyEnvelope());
  state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedReady() });
  state.resolveRuntimeImageTruth.mockReturnValue({
    ok: true,
    truth: { imageId: "sha256:img", sourceCommit: "commit", sourceTree: "tree" },
  });
  state.executeAgentTurn.mockResolvedValue({
    runId: "run-1",
    outcome: { kind: "rejected", payload: { text: "final reply" } },
  });
  state.queueEmbeddedAgentMessageWithOutcomeAsync.mockResolvedValue({ queued: true });
  state.runMemoryFlushIfNeeded.mockResolvedValue({ outcome: "noop", sessionEntry: undefined });
  state.runPreflightCompactionIfNeeded.mockResolvedValue(undefined);
  state.resolveCommandSecretRefsViaGateway.mockClear();
}

type RunParams = {
  isActive?: boolean;
  shouldSteer?: boolean;
  isHeartbeat?: boolean;
  staleReadiness?: ReadinessGovernance;
  sessionCtx?: Record<string, unknown>;
};

async function runCommon(params: RunParams = {}): Promise<unknown> {
  const typing = createMockTypingController();
  const sessionKey = "main";
  const sessionCtx = {
    Provider: "whatsapp",
    OriginatingChannel: "whatsapp",
    OriginatingTo: "+15550001111",
    AccountId: "primary",
    MessageSid: "msg",
    ...params.sessionCtx,
  } as unknown as TemplateContext;
  const resolvedQueue = { mode: "interrupt" } as unknown as QueueSettings;
  const followupRun = {
    prompt: "hello",
    summaryLine: "hello",
    enqueuedAt: Date.now(),
    run: {
      agentId: "main",
      agentDir: "/tmp/agent",
      sessionId: "session",
      sessionKey,
      messageProvider: "whatsapp",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      config: {},
      skillsSnapshot: {},
      provider: "anthropic",
      model: "claude",
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: { enabled: false, allowed: false, defaultLevel: "off" },
      timeoutMs: 1_000,
      blockReplyBreak: "message_end",
      ...(params.staleReadiness ? { readinessGovernance: params.staleReadiness } : {}),
    },
  } as unknown as FollowupRun;
  return runReplyAgent({
    commandBody: "hello",
    followupRun,
    queueKey: sessionKey,
    resolvedQueue,
    shouldSteer: params.shouldSteer === true,
    shouldFollowup: false,
    isActive: params.isActive === true,
    isStreaming: false,
    opts: params.isHeartbeat ? { isHeartbeat: true } : undefined,
    typing,
    sessionCtx,
    sessionEntry: undefined,
    sessionStore: undefined,
    sessionKey,
    defaultModel: "anthropic/claude-opus-4-6",
    agentCfgContextTokens: 200_000,
    resolvedVerboseLevel: "off",
    isNewSession: false,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    shouldInjectGroupIntro: false,
    typingMode: "instant",
  });
}

describe("pre-steer common readiness gate", () => {
  beforeEach(() => {
    vi.useRealTimers();
    clearRuntimeConfigSnapshot();
    resetDiagnosticEventsForTest();
    resetSystemEventsForTest();
    replyRunRegistryTesting.resetReplyRunRegistry();
    queueState.enqueueFollowupRun.mockReset();
    queueState.scheduleFollowupDrain.mockReset();
    queueState.clearSessionQueues.mockReset();
    queueState.clearSessionQueues.mockReturnValue({ followupCleared: 0, laneCleared: 0, keys: [] });
    queueState.refreshQueuedFollowupSession.mockReset();
    queueState.refreshQueuedFollowupSession.mockResolvedValue(undefined);
    state.loadCanonicalReadinessEnvelopeV2.mockReset();
    state.prepareReadinessForRun.mockReset();
    state.resolveRuntimeImageTruth.mockReset();
    state.executeAgentTurn.mockReset();
    state.queueEmbeddedAgentMessageWithOutcomeAsync.mockReset();
    makeReadyDefaults();
  });

  afterEach(() => {
    cliBackendsTesting.resetDepsForTest();
    clearRuntimeConfigSnapshot();
    resetDiagnosticEventsForTest();
    resetSystemEventsForTest();
    vi.useRealTimers();
    clearMemoryPluginState();
    replyRunRegistryTesting.resetReplyRunRegistry();
  });

  it("READY prepared: proceeds and evaluates readiness exactly once", async () => {
    const result = await runCommon();
    expect(result).toEqual({ text: "final reply" });
    expect(state.loadCanonicalReadinessEnvelopeV2).toHaveBeenCalledTimes(1);
    expect(state.resolveRuntimeImageTruth).toHaveBeenCalledTimes(1);
    expect(state.prepareReadinessForRun).toHaveBeenCalledTimes(1);
    expect(state.executeAgentTurn).toHaveBeenCalledTimes(1);
    // Prepared-lane secret resolution stays lane-local: executed once downstream,
    // never as part of the common gate.
    expect(state.resolveCommandSecretRefsViaGateway).toHaveBeenCalledTimes(1);
  });

  it("BLOCKED prepared: silent blocked payload, zero downstream execution", async () => {
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    const result = await runCommon();
    expect(result).toEqual({ text: SILENT_REPLY_TOKEN });
    expect(state.executeAgentTurn).not.toHaveBeenCalled();
    expect(queueState.enqueueFollowupRun).not.toHaveBeenCalled();
    expect(state.resolveCommandSecretRefsViaGateway).not.toHaveBeenCalled();
    expect(replyRunRegistry.get("main")).toBeUndefined();
  });

  it("READY steer: embedded enqueue allowed, no prepared execution", async () => {
    const result = await runCommon({ isActive: true, shouldSteer: true });
    expect(state.queueEmbeddedAgentMessageWithOutcomeAsync).toHaveBeenCalledTimes(1);
    expect(state.queueEmbeddedAgentMessageWithOutcomeAsync.mock.calls[0]?.[0]).toBe("session");
    expect(result).toBeUndefined();
    expect(state.executeAgentTurn).not.toHaveBeenCalled();
  });

  it("BLOCKED steer: embedded enqueue zero, silent blocked payload", async () => {
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    const result = await runCommon({ isActive: true, shouldSteer: true });
    expect(state.queueEmbeddedAgentMessageWithOutcomeAsync).not.toHaveBeenCalled();
    expect(result).toEqual({ text: SILENT_REPLY_TOKEN });
    expect(state.executeAgentTurn).not.toHaveBeenCalled();
  });

  it("stale pre-restart READY ignored: fresh BLOCKED wins", async () => {
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    const result = await runCommon({ staleReadiness: makeGovernedReady() });
    expect(result).toEqual({ text: SILENT_REPLY_TOKEN });
    expect(state.executeAgentTurn).not.toHaveBeenCalled();
    expect(state.queueEmbeddedAgentMessageWithOutcomeAsync).not.toHaveBeenCalled();
    expect(state.prepareReadinessForRun).toHaveBeenCalledTimes(1);
  });

  it("runtime image mismatch: fresh BLOCKED, provenance failure surfaces", async () => {
    state.resolveRuntimeImageTruth.mockReturnValue({
      ok: false,
      code: "PROVENANCE_MALFORMED",
      message: "test",
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    const result = await runCommon();
    expect(result).toEqual({ text: SILENT_REPLY_TOKEN });
    const prepArgs = state.prepareReadinessForRun.mock.calls[0]?.[0] as {
      runtimeImageTruth?: unknown;
    };
    expect(prepArgs.runtimeImageTruth).toEqual({
      ok: false,
      code: "PROVENANCE_MALFORMED",
      message: "test",
    });
    expect(state.executeAgentTurn).not.toHaveBeenCalled();
  });

  it("config digest mismatch: fresh BLOCKED", async () => {
    // Envelope binding carries a config digest that the real builder would not
    // reproduce; the mocked evaluator blocks on the mismatch verdict.
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    const result = await runCommon();
    expect(result).toEqual({ text: SILENT_REPLY_TOKEN });
    expect(state.executeAgentTurn).not.toHaveBeenCalled();
    expect(state.prepareReadinessForRun).toHaveBeenCalledTimes(1);
  });

  it("malformed/unavailable envelope or runtime truth: fresh BLOCKED", async () => {
    state.loadCanonicalReadinessEnvelopeV2.mockReturnValue({
      ok: false,
      code: "EVIDENCE_MISSING",
      message: "test",
    });
    state.resolveRuntimeImageTruth.mockReturnValue({
      ok: false,
      code: "PROVENANCE_MISSING",
      message: "test",
    });
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    const result = await runCommon();
    expect(result).toEqual({ text: SILENT_REPLY_TOKEN });
    expect(state.executeAgentTurn).not.toHaveBeenCalled();
    const prepArgs = state.prepareReadinessForRun.mock.calls[0]?.[0] as {
      evidenceJson?: string | null;
      runtimeImageTruth?: unknown;
    };
    expect(prepArgs.evidenceJson).toBeNull();
    expect(prepArgs.runtimeImageTruth).toEqual({
      ok: false,
      code: "PROVENANCE_MISSING",
      message: "test",
    });
  });

  it("heartbeat remains fail-closed: READY proceeds, BLOCKED is silent", async () => {
    const readyResult = await runCommon({ isHeartbeat: true });
    expect(readyResult).toEqual({ text: "final reply" });
    expect(state.prepareReadinessForRun).toHaveBeenCalledTimes(1);

    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    state.executeAgentTurn.mockClear();
    const blockedResult = await runCommon({ isHeartbeat: true });
    expect(blockedResult).toEqual({ text: SILENT_REPLY_TOKEN });
    expect(state.executeAgentTurn).not.toHaveBeenCalled();
  });

  it("prepared lane performs one fresh readiness evaluation only (gate + reuse)", async () => {
    await runCommon();
    // Gate evaluation happens once; the prepared lane must not re-evaluate.
    expect(state.prepareReadinessForRun).toHaveBeenCalledTimes(1);
    expect(state.loadCanonicalReadinessEnvelopeV2).toHaveBeenCalledTimes(1);
    expect(state.resolveRuntimeImageTruth).toHaveBeenCalledTimes(1);
  });

  it("no embedded enqueue when BLOCKED (steer enforcement)", async () => {
    state.prepareReadinessForRun.mockReturnValue({ ok: true, governance: makeGovernedBlocked() });
    await runCommon({ isActive: true, shouldSteer: true });
    expect(state.queueEmbeddedAgentMessageWithOutcomeAsync).not.toHaveBeenCalled();
  });

  it("canonical model normalization + governing digest machinery preserved", async () => {
    await runCommon();
    const prepArgs = state.prepareReadinessForRun.mock.calls[0]?.[0] as {
      v2?: { validation: { expectedConfigDigest: string; expectedModelPolicy: string } };
    };
    // The v2 input is built by the real builder chain, so the digest is the
    // canonicalized-model digest, not a placeholder.
    expect(prepArgs.v2).toBeDefined();
    expect(prepArgs.v2?.validation.expectedConfigDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(prepArgs.v2?.validation.expectedModelPolicy).toBe("openai/gpt-5.6-sol");
  });

  it("config and agentId are finalized before the steer/prepared branch", async () => {
    state.executeAgentTurn.mockImplementationOnce(async (params: { followupRun: FollowupRun }) => {
      expect(params.followupRun.run.agentId).toBe("main");
      expect(params.followupRun.run.config).toBeDefined();
      return {
        runId: "run-1",
        outcome: { kind: "rejected", payload: { text: "final reply" } },
      };
    });
    const result = await runCommon();
    expect(result).toEqual({ text: "final reply" });
  });
});
