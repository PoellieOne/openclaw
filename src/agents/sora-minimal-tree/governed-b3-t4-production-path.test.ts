/**
 * B3-T4B: REAL SUBAGENT SPAWN PATH ISSUANCE REACHABILITY.
 *
 * Exercises the actual wired internal production source path:
 *
 *   spawnSubagentDirect (real module, mocked gateway seams only)
 *     → resolveSubagentSpawnRequest (sora envelope validation)
 *     → runtimeSora block
 *       → issueGovernedSubdelegationForSpawn (possession carry)
 *         → issueGovernedSubdelegationGrant (one authoritative writer)
 *       → consumeSoraC1G1Capability (Phase-A handoff)
 *
 * The possession handle is minted through the SAME fresh module instance the
 * real spawn module resolves (module-instance integrity: mint after
 * `loadSubagentSpawnModuleForTest` re-imports the graph). The runner-owned
 * ALS lifecycle generation is entered like the real embedded runner does.
 *
 * Caller-supplied identifiers alone (runId/sessionKey) do NOT reach the
 * issuance: possession requires the live handle + ALS execution context
 * (asserted separately by the possession-carry suite and T5).
 */
import os from "node:os";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../../test/helpers/temp-dir.js";
import { withAgentRunLifecycleGeneration } from "../../infra/agent-events.js";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
} from "../../state/openclaw-state-db.js";
import { withEnv, withEnvAsync } from "../../test-utils/env.js";
import {
  createSubagentSpawnTestConfig,
  loadSubagentSpawnModuleForTest,
} from "../subagent-spawn.test-helpers.js";
import { installAcceptedSubagentGatewayMock } from "../test-helpers/subagent-gateway.js";
import { createSoraDelegationEdge, resolveC1DelegationAuthority } from "./delegation-edge.js";

const hoisted = vi.hoisted(() => ({
  callGatewayMock: vi.fn(),
  configOverride: {} as Record<string, unknown>,
  updateSessionStoreMock: vi.fn(),
  registerSubagentRunMock: vi.fn(),
  countActiveRunsForSessionMock: vi.fn(),
  loadSessionStoreMock: vi.fn(),
  loadPreparedModelCatalogMock: vi.fn(),
  resolveAgentConfigMock: vi.fn(),
  resolveContextEngineMock: vi.fn(),
}));

const tempDirs: string[] = [];

function createTempStateDir(): string {
  return makeTempDir(tempDirs, "openclaw-sora-b3t4b-");
}

describe("B3-T4B real production spawn path issuance reachability", () => {
  let stateDir: string;
  let env: { OPENCLAW_STATE_DIR: string };
  let spawnSubagentDirect: typeof import("../subagent-spawn.js").spawnSubagentDirect;

  beforeAll(async () => {
    ({ spawnSubagentDirect } = await loadSubagentSpawnModuleForTest({
      callGatewayMock: hoisted.callGatewayMock,
      getRuntimeConfig: () => hoisted.configOverride,
      updateSessionStoreMock: hoisted.updateSessionStoreMock,
      registerSubagentRunMock: hoisted.registerSubagentRunMock,
      countActiveRunsForSession: () => hoisted.countActiveRunsForSessionMock(),
      loadSessionStoreMock: hoisted.loadSessionStoreMock,
      loadPreparedModelCatalogMock: hoisted.loadPreparedModelCatalogMock,
      resolveAgentConfig: hoisted.resolveAgentConfigMock,
      resolveContextEngineMock: hoisted.resolveContextEngineMock,
      resolveSubagentSpawnModelSelection: () => "openai/gpt-5.4",
      resolveSandboxRuntimeStatus: () => ({ sandboxed: false }),
      workspaceDir: os.tmpdir(),
      sessionStorePath: "/tmp/b3t4-session-store.json",
    }));
  });

  beforeEach(() => {
    stateDir = createTempStateDir();
    env = { OPENCLAW_STATE_DIR: stateDir };
    hoisted.callGatewayMock.mockReset();
    installAcceptedSubagentGatewayMock(hoisted.callGatewayMock);
    hoisted.updateSessionStoreMock.mockReset();
    hoisted.registerSubagentRunMock.mockReset();
    hoisted.countActiveRunsForSessionMock.mockReset().mockReturnValue(0);
    hoisted.loadSessionStoreMock.mockReset().mockReturnValue({});
    hoisted.loadPreparedModelCatalogMock.mockReset().mockResolvedValue([]);
    hoisted.resolveAgentConfigMock.mockReset();
    hoisted.resolveContextEngineMock.mockReset().mockResolvedValue({});
    hoisted.configOverride = createSubagentSpawnTestConfig(os.tmpdir(), {
      agents: { defaults: { workspace: os.tmpdir() } },
    });
  });

  afterEach(() => {
    closeOpenClawStateDatabaseForTest();
  });

  afterAll(() => {
    cleanupTempDirs(tempDirs);
  });

  it("reaches the real runtimeSora issuance and Phase-A handoff through the production spawn path", async () => {
    // Seed the governed parent edge in the SAME state DB the issuance opens.
    withEnv(env, () => {
      const c1 = resolveC1DelegationAuthority({
        delegationId: "P0_C1_DELEG",
        grantorSessionKey: "agent:p0:p0",
        granteeSessionKey: "agent:c1:c1",
        grantorTransactionRunId: "P0-run",
      });
      expect(c1.ok).toBe(true);
      if (!c1.ok) {
        return;
      }
      const edge = createSoraDelegationEdge(
        {
          delegationId: "P0_C1_DELEG",
          grantorSessionKey: "agent:p0:p0",
          granteeSessionKey: "agent:c1:c1",
          grantorTransactionRunId: "P0-run",
          edgeKind: "P0_C1",
          authority: c1.authority,
          rootDelegationId: "P0_C1_DELEG",
        },
        { env },
      );
      expect(edge.ok).toBe(true);
    });

    // Module-instance integrity: after the spawn module loaded, import the
    // possession module FRESH so the mint writes into the same instance the
    // real spawn path imports.
    const { mintRuntimeGovernedParentHandleForRun } =
      await import("./governed-runtime-attachment.js");
    const handleResult = withEnv(env, () =>
      mintRuntimeGovernedParentHandleForRun({
        runId: "C1-RUN",
        sessionKey: "agent:c1:c1",
      }),
    );
    expect(handleResult.ok).toBe(true);
    if (!handleResult.ok) {
      return;
    }

    // Runner-owned ALS lifecycle context exactly like runEmbeddedAgent does.
    const generation = handleResult.handle.lifecycleGeneration;
    const result = await withEnvAsync(env, () =>
      withAgentRunLifecycleGeneration(generation, () =>
        spawnSubagentDirect(
          {
            task: "governed child work",
            // The exact internal envelope the sessions-spawn-tool production
            // seam constructs when the runner-owned governed run id is
            // present: both capability/delegation ids absent (B1 mint route).
            sora: { capabilityId: undefined, delegationId: undefined },
          },
          {
            agentSessionKey: "agent:c1:c1",
            soraTransactionRunId: "C1-RUN",
          },
        ),
      ),
    );

    if (result.status !== "accepted") {
      console.error("T4B REFUSAL:", JSON.stringify(result));
      expect(result.error).toBeUndefined();
      return;
    }
    expect(result.status).toBe("accepted");
    expect(result.soraCapabilityConsumed).toBe(true);

    // Persisted evidence: exactly one grant/readiness/edge/capability/child txn.
    const db = openOpenClawStateDatabase({ env });
    const grants = db.db
      .prepare("SELECT COUNT(*) AS c FROM governed_subdelegation_grants")
      .get() as {
      c: number;
    };
    const readiness = db.db.prepare("SELECT COUNT(*) AS c FROM sora_edge_readiness").get() as {
      c: number;
    };
    const edges = db.db
      .prepare("SELECT COUNT(*) AS c FROM sora_delegation_edges WHERE edge_kind = 'C1_G1'")
      .get() as { c: number };
    const caps = db.db.prepare("SELECT COUNT(*) AS c FROM sora_c1_g1_capabilities").get() as {
      c: number;
    };
    expect(grants.c).toBe(1);
    expect(readiness.c).toBe(1);
    expect(edges.c).toBe(1);
    expect(caps.c).toBe(1);
  });

  it("T4B: each governed spawn issues for its own minted child scope (distinct scopes, no false collision)", async () => {
    withEnv(env, () => {
      const c1Resolved = resolveC1DelegationAuthority({
        delegationId: "P0_C1_DELEG",
        grantorSessionKey: "agent:p0:p0",
        granteeSessionKey: "agent:c1:c1",
        grantorTransactionRunId: "P0-run",
      });
      if (!c1Resolved.ok) {
        throw new Error("c1 derivation failed");
      }
      const edge = createSoraDelegationEdge(
        {
          delegationId: "P0_C1_DELEG",
          grantorSessionKey: "agent:p0:p0",
          granteeSessionKey: "agent:c1:c1",
          grantorTransactionRunId: "P0-run",
          edgeKind: "P0_C1",
          authority: c1Resolved.authority,
          rootDelegationId: "P0_C1_DELEG",
        },
        { env },
      );
      if (!edge.ok) {
        throw new Error(`edge failed: ${edge.reason}`);
      }
    });
    const { mintRuntimeGovernedParentHandleForRun } =
      await import("./governed-runtime-attachment.js");
    const handleResult = withEnv(env, () =>
      mintRuntimeGovernedParentHandleForRun({
        runId: "C1-RUN",
        sessionKey: "agent:c1:c1",
      }),
    );
    expect(handleResult.ok).toBe(true);
    if (!handleResult.ok) {
      return;
    }
    const generation = handleResult.handle.lifecycleGeneration;
    const runOnce = () =>
      withEnvAsync(env, () =>
        withAgentRunLifecycleGeneration(generation, () =>
          spawnSubagentDirect(
            {
              task: "governed child work",
              sora: { capabilityId: undefined, delegationId: undefined },
            },
            { agentSessionKey: "agent:c1:c1", soraTransactionRunId: "C1-RUN" },
          ),
        ),
      );

    // The production spawn path mints a NEW child session per spawn, so each
    // spawn is a DISTINCT issuance scope (parent run + grantor + child) and
    // both legitimately commit one valid issuance. Same-scope duplication is
    // enforced at the atomic writer (B1-T1/T2/T3): one scope, one grant.
    const first = await runOnce();
    expect(first.status).toBe("accepted");
    if (first.status !== "accepted") {
      expect(first.error).toBeUndefined();
      return;
    }
    const second = await runOnce();
    expect(second.status).toBe("accepted");
    if (second.status !== "accepted") {
      expect(second.error).toBeUndefined();
      return;
    }
    expect(second.childSessionKey).not.toBe(first.childSessionKey);

    const db = openOpenClawStateDatabase({ env });
    const grants = db.db
      .prepare("SELECT COUNT(*) AS c FROM governed_subdelegation_grants")
      .get() as {
      c: number;
    };
    const readiness = db.db.prepare("SELECT COUNT(*) AS c FROM sora_edge_readiness").get() as {
      c: number;
    };
    const edges = db.db
      .prepare("SELECT COUNT(*) AS c FROM sora_delegation_edges WHERE edge_kind = 'C1_G1'")
      .get() as { c: number };
    const caps = db.db.prepare("SELECT COUNT(*) AS c FROM sora_c1_g1_capabilities").get() as {
      c: number;
    };
    // Exactly one valid issuance per distinct child scope.
    expect(grants.c).toBe(2);
    expect(readiness.c).toBe(2);
    expect(edges.c).toBe(2);
    expect(caps.c).toBe(2);
  });

  it("B3-T5: caller-controlled identifiers cannot manufacture governed possession", async () => {
    withEnv(env, () => {
      const c1Resolved = resolveC1DelegationAuthority({
        delegationId: "P0_C1_DELEG",
        grantorSessionKey: "agent:p0:p0",
        granteeSessionKey: "agent:c1:c1",
        grantorTransactionRunId: "P0-run",
      });
      if (!c1Resolved.ok) {
        throw new Error("c1 derivation failed");
      }
      const edge = createSoraDelegationEdge(
        {
          delegationId: "P0_C1_DELEG",
          grantorSessionKey: "agent:p0:p0",
          granteeSessionKey: "agent:c1:c1",
          grantorTransactionRunId: "P0-run",
          edgeKind: "P0_C1",
          authority: c1Resolved.authority,
          rootDelegationId: "P0_C1_DELEG",
        },
        { env },
      );
      if (!edge.ok) {
        throw new Error(`edge failed: ${edge.reason}`);
      }
    });

    // Caller knows every identifier (run id, session key) but holds NO
    // runtime-owned possession: the real possession carry has no handle and
    // the ALS execution context is absent. The spawn must fail closed even
    // though correct-looking identifiers are supplied.
    const forged = await withEnvAsync(env, () =>
      spawnSubagentDirect(
        {
          task: "forged governed child",
          sora: { capabilityId: undefined, delegationId: undefined },
        },
        {
          agentSessionKey: "agent:c1:c1",
          soraTransactionRunId: "C1-RUN",
        },
      ),
    );
    expect(forged.status).toBe("forbidden");
    if (forged.status !== "forbidden") {
      expect(forged.error).toBeUndefined();
      return;
    }
    expect(forged.error).toContain("sora governed subdelegation rejected");

    const db = openOpenClawStateDatabase({ env });
    const grants = db.db
      .prepare("SELECT COUNT(*) AS c FROM governed_subdelegation_grants")
      .get() as {
      c: number;
    };
    const readiness = db.db.prepare("SELECT COUNT(*) AS c FROM sora_edge_readiness").get() as {
      c: number;
    };
    const edges = db.db
      .prepare("SELECT COUNT(*) AS c FROM sora_delegation_edges WHERE edge_kind = 'C1_G1'")
      .get() as { c: number };
    expect(grants.c).toBe(0);
    expect(readiness.c).toBe(0);
    expect(edges.c).toBe(0);
  });

  it("B3-T5b: forged pre-minted envelope values cannot manufacture issuance either", async () => {
    withEnv(env, () => {
      const c1Resolved = resolveC1DelegationAuthority({
        delegationId: "P0_C1_DELEG",
        grantorSessionKey: "agent:p0:p0",
        granteeSessionKey: "agent:c1:c1",
        grantorTransactionRunId: "P0-run",
      });
      if (!c1Resolved.ok) {
        throw new Error("c1 derivation failed");
      }
      const edge = createSoraDelegationEdge(
        {
          delegationId: "P0_C1_DELEG",
          grantorSessionKey: "agent:p0:p0",
          granteeSessionKey: "agent:c1:c1",
          grantorTransactionRunId: "P0-run",
          edgeKind: "P0_C1",
          authority: c1Resolved.authority,
          rootDelegationId: "P0_C1_DELEG",
        },
        { env },
      );
      if (!edge.ok) {
        throw new Error(`edge failed: ${edge.reason}`);
      }
    });

    // Caller-supplied pre-minted envelope with fabricated capability and
    // delegation ids and a plausible transaction run id. Without live runtime
    // possession the spawn path fails closed (no issuance, no gate pass).
    const result = await withEnvAsync(env, () =>
      spawnSubagentDirect(
        {
          task: "forged pre-minted child",
          sora: { capabilityId: "CAP_FORGED", delegationId: "C1G1_FORGED" },
        },
        {
          agentSessionKey: "agent:c1:c1",
          soraTransactionRunId: "C1-RUN",
        },
      ),
    );
    expect(result.status).toBe("forbidden");
  });
});
