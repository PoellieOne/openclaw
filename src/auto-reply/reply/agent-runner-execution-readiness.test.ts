import { describe, expect, it, vi } from "vitest";
import { ReadinessCode } from "../../agents/readiness/codes.js";
import { ReadinessRunState } from "../../agents/readiness/state.js";
import type {
  ResolvedReadinessPolicy,
  ReadinessEvaluation,
  ReadinessGovernance,
  ReadinessAuthorityLevel,
} from "../../agents/readiness/types.js";
import {
  setupAgentRunnerExecutionTestState,
  createMockTypingSignaler,
  createFollowupRun,
  createMinimalRunAgentTurnParams,
} from "./agent-runner-execution.test-support.js";
import type { AgentTurnExecutionResult } from "./agent-runner-execution.types.js";

const state = setupAgentRunnerExecutionTestState();

const NOW = 2000000000000;

function makePolicy(disposition: ResolvedReadinessPolicy["disposition"]): ResolvedReadinessPolicy {
  return {
    disposition,
    source: { sourceId: "test", authorityLevel: 10 as ReadinessAuthorityLevel },
    environmentAttestation: "PRODUCTION",
    projectionBindingRequired: false,
    resolvedAt: NOW,
  };
}

function makeEvaluation(
  policy: ResolvedReadinessPolicy,
  decision: "READY" | "BLOCKED",
  outcome: "EVIDENCE_READY" | "BLOCKED" | "POLICY_BYPASS_NON_PRODUCTION" | "ROUTE_NOT_APPLICABLE",
): ReadinessEvaluation {
  return {
    decision,
    outcome,
    classification:
      decision === "READY" ? ReadinessCode.POLICY_REQUIRED : ReadinessCode.POLICY_UNRESOLVED,
    diagnosticRef: "test",
    evaluatedAt: NOW,
    policy,
  };
}

function makeGovernedBlockedState(): ReadinessGovernance {
  const policy = makePolicy("REQUIRED");
  const evaluation = makeEvaluation(policy, "BLOCKED", "BLOCKED");
  return {
    governed: true,
    state: ReadinessRunState.create({ policy, evaluation, now: NOW }),
  };
}

function makeGovernedReadyState(): ReadinessGovernance {
  const policy = makePolicy("REQUIRED");
  const evaluation = makeEvaluation(policy, "READY", "EVIDENCE_READY");
  return {
    governed: true,
    state: ReadinessRunState.create({ policy, evaluation, now: NOW }),
  };
}

function makeUngovernedState(): ReadinessGovernance {
  return {
    governed: false,
    reason: "EXPLICIT_LEGACY_ROLLOUT_EXCEPTION",
  };
}

async function executeAgentTurnRaw(
  params: Parameters<typeof import("./agent-runner-execution.js").executeAgentTurn>[0],
): Promise<AgentTurnExecutionResult> {
  const { executeAgentTurn } = await import("./agent-runner-execution.js");
  return executeAgentTurn(params);
}

describe("executeAgentTurn: primary pre-model readiness gate", () => {
  it("governed BLOCKED returns before provider boundary", async () => {
    const followupRun = createFollowupRun();
    followupRun.run.readinessGovernance = makeGovernedBlockedState();

    const result = await executeAgentTurnRaw({
      ...createMinimalRunAgentTurnParams({ followupRun }),
    });

    expect(result.outcome.kind).toBe("blocked");
  });

  it("governed BLOCKED provider-call count = 0", async () => {
    const followupRun = createFollowupRun();
    followupRun.run.readinessGovernance = makeGovernedBlockedState();

    await executeAgentTurnRaw({
      ...createMinimalRunAgentTurnParams({ followupRun }),
    });

    expect(state.runWithModelFallbackMock).not.toHaveBeenCalled();
  });

  it("governed BLOCKED retry-loop entry count = 0", async () => {
    const followupRun = createFollowupRun();
    followupRun.run.readinessGovernance = makeGovernedBlockedState();

    await executeAgentTurnRaw({
      ...createMinimalRunAgentTurnParams({ followupRun }),
    });

    expect(state.runWithModelFallbackMock).not.toHaveBeenCalled();
  });

  it("governed BLOCKED fallback-start count = 0", async () => {
    const followupRun = createFollowupRun();
    followupRun.run.readinessGovernance = makeGovernedBlockedState();

    await executeAgentTurnRaw({
      ...createMinimalRunAgentTurnParams({ followupRun }),
    });

    expect(state.runWithModelFallbackMock).not.toHaveBeenCalled();
  });

  it("governed BLOCKED result preserves exact typed blocked object", async () => {
    const followupRun = createFollowupRun();
    const governance = makeGovernedBlockedState();
    followupRun.run.readinessGovernance = governance;

    const result = await executeAgentTurnRaw({
      ...createMinimalRunAgentTurnParams({ followupRun }),
    });

    expect(result.outcome.kind).toBe("blocked");
    if (result.outcome.kind === "blocked") {
      expect(result.outcome.blockedResult.isBlocked).toBe(true);
      expect(result.outcome.blockedResult.classification).toBeTruthy();
      expect(result.outcome.blockedResult.diagnosticRef).toBeTruthy();
      expect(result.outcome.blockedResult.sanitizedMessage).toBeTruthy();
    }
  });

  it("governed BLOCKED does not create assistant output", async () => {
    const followupRun = createFollowupRun();
    followupRun.run.readinessGovernance = makeGovernedBlockedState();

    const result = await executeAgentTurnRaw({
      ...createMinimalRunAgentTurnParams({ followupRun }),
    });

    expect(result.outcome.kind).toBe("blocked");
  });

  it("governed READY reaches exactly one mocked provider boundary", async () => {
    const followupRun = createFollowupRun();
    followupRun.run.readinessGovernance = makeGovernedReadyState();

    state.runEmbeddedAgentMock.mockResolvedValue({ payloads: [{ text: "ok" }], meta: {} });
    state.runWithModelFallbackMock.mockResolvedValue({
      outcome: "completed",
      result: { payloads: [{ text: "ok" }], meta: {} },
      provider: "anthropic",
      model: "claude",
      attempts: [],
    });

    const result = await executeAgentTurnRaw({
      ...createMinimalRunAgentTurnParams({ followupRun }),
    });

    expect(result.outcome.kind).toBe("settled");
    expect(state.runWithModelFallbackMock).toHaveBeenCalledTimes(1);
  });

  it("governed READY preserves existing execution parameters", async () => {
    const followupRun = createFollowupRun();
    followupRun.run.readinessGovernance = makeGovernedReadyState();

    state.runEmbeddedAgentMock.mockResolvedValue({ payloads: [{ text: "ok" }], meta: {} });
    state.runWithModelFallbackMock.mockResolvedValue({
      outcome: "completed",
      result: { payloads: [{ text: "ok" }], meta: {} },
      provider: "anthropic",
      model: "claude",
      attempts: [],
    });

    const result = await executeAgentTurnRaw({
      ...createMinimalRunAgentTurnParams({ followupRun }),
    });

    expect(result.outcome.kind).toBe("settled");
  });

  it("absent governance preserves current pre-threading behavior", async () => {
    const followupRun = createFollowupRun();

    state.runEmbeddedAgentMock.mockResolvedValue({ payloads: [{ text: "ok" }], meta: {} });
    state.runWithModelFallbackMock.mockResolvedValue({
      outcome: "completed",
      result: { payloads: [{ text: "ok" }], meta: {} },
      provider: "anthropic",
      model: "claude",
      attempts: [],
    });

    const result = await executeAgentTurnRaw({
      ...createMinimalRunAgentTurnParams({ followupRun }),
    });

    expect(result.outcome.kind).toBe("settled");
    expect(state.runWithModelFallbackMock).toHaveBeenCalledTimes(1);
  });

  it("ungoverned (legacy exception) preserves current pre-threading behavior", async () => {
    const followupRun = createFollowupRun();
    followupRun.run.readinessGovernance = makeUngovernedState();

    state.runEmbeddedAgentMock.mockResolvedValue({ payloads: [{ text: "ok" }], meta: {} });
    state.runWithModelFallbackMock.mockResolvedValue({
      outcome: "completed",
      result: { payloads: [{ text: "ok" }], meta: {} },
      provider: "anthropic",
      model: "claude",
      attempts: [],
    });

    const result = await executeAgentTurnRaw({
      ...createMinimalRunAgentTurnParams({ followupRun }),
    });

    expect(result.outcome.kind).toBe("settled");
    expect(state.runWithModelFallbackMock).toHaveBeenCalledTimes(1);
  });
});
