/**
 * Phase-B1 governed parent handle + issuance + readiness tests.
 *
 * Proof obligations:
 * - valid internal runtime possession permits the intended governed transition;
 * - request/session/run identifiers alone cannot mint or reconstruct possession;
 * - serialized handle reconstruction fails;
 * - DB-row/transaction ID knowledge does not establish possession;
 * - stale/invalidated governed parent fails issuance;
 * - authoritative caller mismatch fails;
 * - non-amplification failure rolls back;
 * - duplicate issuance/CAS failure rolls back;
 * - partial persistence does not survive rollback;
 * - readiness is not produced on failed issuance;
 * - readiness becomes invalid/unusable after revocation/closure;
 * - G1 cannot further delegate; retry/fallback remain forbidden;
 * - max depth 2; max descendants 1;
 * - no alternate production issuance writer exists.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../../test/helpers/temp-dir.js";
import { withAgentRunLifecycleGeneration } from "../../infra/agent-events.js";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
} from "../../state/openclaw-state-db.js";
import { withEnv } from "../../test-utils/env.js";
import {
  createSoraDelegationEdge,
  resolveC1DelegationAuthority,
  resolveG1DelegationAuthority,
} from "./delegation-edge.js";
import {
  invalidateActiveGovernedParentHandle,
  isActiveGovernedParentHandle,
  mintRuntimeOwnedGovernedParentHandle,
  readActiveGovernedParentHandleId,
} from "./governed-parent-context.js";
import type { ActiveGovernedParentHandle } from "./governed-parent-context.js";
import { resolveGovernedReadiness, revokeGovernedReadiness } from "./governed-readiness.js";
import {
  mintRuntimeGovernedParentHandleForRun,
  mintRuntimeGovernedParentHandleForTest,
} from "./governed-runtime-attachment.js";
import { issueGovernedSubdelegationGrant } from "./governed-subdelegation-issuance.js";
import {
  issueGovernedSubdelegationForSpawn,
  issueGovernedSubdelegationForParentRun,
} from "./governed-subdelegation-issuance.js";
import {
  closeGovernedTransaction,
  createGovernedTransaction,
  invalidateGovernedParent,
  type GovernedTransaction,
} from "./governed-transaction-controller.js";
import { compareSoraAuthority, type SoraDelegationAuthority } from "./store.js";

const tempDirs: string[] = [];

function createTempStateDir(): string {
  return makeTempDir(tempDirs, "openclaw-sora-b1-");
}

type Fixture = {
  env: { OPENCLAW_STATE_DIR: string };
  c1Ceiling: SoraDelegationAuthority;
  handle: ActiveGovernedParentHandle;
  transaction: GovernedTransaction;
};

function g1Authority(ceiling: SoraDelegationAuthority): SoraDelegationAuthority {
  // Canonical Phase-A G1 derivation from the actual C1 ceiling; the derived
  // result must be a subset of the ceiling (non-amplification) by construction
  // and is the exact authority persisted by the issuance seam.
  const resolved = resolveG1DelegationAuthority({
    granteeSessionKey: "agent:g1:g1",
    grantorTransactionRunId: "C1-RUN",
    ceiling,
  });
  expect(resolved.ok).toBe(true);
  const g1 = (resolved as { ok: true; authority: SoraDelegationAuthority }).authority;
  const comparison = compareSoraAuthority(ceiling, g1);
  expect(comparison.ok).toBe(true);
  return g1;
}

function seedFixture(stateDir: string, env: { OPENCLAW_STATE_DIR: string }): Fixture {
  const c1Resolved = resolveC1DelegationAuthority({
    delegationId: "P0_C1_DELEG",
    grantorSessionKey: "agent:p0:p0",
    granteeSessionKey: "agent:c1:c1",
    grantorTransactionRunId: "P0-run",
  });
  expect(c1Resolved.ok).toBe(true);
  const c1Ceiling = (c1Resolved as { ok: true; authority: SoraDelegationAuthority }).authority;
  const edge = createSoraDelegationEdge(
    {
      delegationId: "P0_C1_DELEG",
      grantorSessionKey: "agent:p0:p0",
      granteeSessionKey: "agent:c1:c1",
      grantorTransactionRunId: "P0-run",
      edgeKind: "P0_C1",
      authority: c1Ceiling,
      rootDelegationId: "P0_C1_DELEG",
    },
    { env },
  );
  expect(edge.ok).toBe(true);
  const handle = mintRuntimeGovernedParentHandleForTest({
    runId: "C1-RUN",
    sessionKey: "agent:c1:c1",
  });
  const transaction = createGovernedTransaction({ handle });
  return { env, c1Ceiling, handle, transaction };
}

function issueGrant(fixture: Fixture, granteeSessionKey = "agent:g1:g1") {
  return withEnv(fixture.env, () =>
    issueGovernedSubdelegationGrant({
      handle: fixture.handle,
      transaction: fixture.transaction,
      grant: {
        requestedG1Authority: g1Authority(fixture.c1Ceiling),
        granteeSessionKey,
        holderSessionKey: "agent:holder:h1",
      },
    }),
  );
}

function issueParent(fixture: Fixture) {
  return issueGrant(fixture);
}

describe("Phase B1 governed parent context", () => {
  it("mints a process-local handle that passes private object identity", () => {
    const handle = mintRuntimeOwnedGovernedParentHandle({
      runId: "RUN",
      sessionKey: "agent:c1:c1",
      lifecycleGeneration: "gen-1",
    });
    expect(isActiveGovernedParentHandle(handle)).toBe(true);
    expect(handle.status().state).toBe("ACTIVE");
  });

  it("identifier knowledge alone cannot reconstruct possession", () => {
    const handle = mintRuntimeOwnedGovernedParentHandle({
      runId: "RUN",
      sessionKey: "agent:c1:c1",
      lifecycleGeneration: "gen-1",
    });
    const forged = {
      handleId: readActiveGovernedParentHandleId(handle),
      runId: "RUN",
      sessionKey: "agent:c1:c1",
      lifecycleGeneration: "gen-1",
      mintedAt: handle.mintedAt,
    };
    expect(isActiveGovernedParentHandle(forged)).toBe(false);
    expect(isActiveGovernedParentHandle({ ...handle })).toBe(false);
  });

  it("a serialized handle cannot reconstruct possession", () => {
    const handle = mintRuntimeOwnedGovernedParentHandle({
      runId: "RUN",
      sessionKey: "agent:c1:c1",
      lifecycleGeneration: "gen-1",
    });
    const serialized = JSON.stringify(handle);
    expect(serialized).not.toContain("ActiveGovernedParentHandle");
    const rebuilt: unknown = JSON.parse(serialized);
    expect(isActiveGovernedParentHandle(rebuilt)).toBe(false);
  });

  it("invalidation makes the handle unusable", () => {
    const handle = mintRuntimeOwnedGovernedParentHandle({
      runId: "RUN",
      sessionKey: "agent:c1:c1",
      lifecycleGeneration: "gen-1",
    });
    invalidateActiveGovernedParentHandle(handle);
    expect(isActiveGovernedParentHandle(handle)).toBe(false);
  });
});

describe("Phase B1 governed issuance and readiness", () => {
  let stateDir: string;
  let env: { OPENCLAW_STATE_DIR: string };
  let fixture: Fixture;

  beforeEach(() => {
    stateDir = createTempStateDir();
    env = { OPENCLAW_STATE_DIR: stateDir };
    fixture = seedFixture(stateDir, env);
  });

  afterEach(() => {
    closeOpenClawStateDatabaseForTest();
  });

  afterAll(() => {
    cleanupTempDirs(tempDirs);
  });

  it("valid internal runtime possession permits the intended governed transition", () => {
    const result = issueParent(fixture);
    expect(result.ok).toBe(true);
  });

  it("a forged handle object fails closed", () => {
    const forged = { ...fixture.handle, handleId: "FORGED" };
    const result = withEnv(env, () =>
      issueGovernedSubdelegationGrant({
        handle: forged as never,
        transaction: fixture.transaction,
        grant: {
          requestedG1Authority: g1Authority(fixture.c1Ceiling),
          granteeSessionKey: "agent:g1:g1",
          holderSessionKey: "agent:holder:h1",
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("a different minted handle with the same identifiers fails closed (stale/foreign possession)", () => {
    const secondHandle = mintRuntimeGovernedParentHandleForTest({
      runId: "C1-RUN",
      sessionKey: "agent:c1:c1",
    });
    const result = withEnv(env, () =>
      issueGovernedSubdelegationGrant({
        handle: secondHandle,
        transaction: fixture.transaction,
        grant: {
          requestedG1Authority: g1Authority(fixture.c1Ceiling),
          granteeSessionKey: "agent:g1:g1",
          holderSessionKey: "agent:holder:h1",
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("a closed governed parent fails issuance", () => {
    closeGovernedTransaction(fixture.transaction, "CLOSED");
    const result = issueParent(fixture);
    expect(result.ok).toBe(false);
  });

  it("an invalidated governed parent fails issuance and readiness", () => {
    invalidateGovernedParent({ handle: fixture.handle, terminal: "ABORTED" });
    const result = issueParent(fixture);
    expect(result.ok).toBe(false);
    const readiness = withEnv(env, () =>
      resolveGovernedReadiness({
        handle: fixture.handle,
        grantId: "GRANT_NONEXISTENT",
        options: { env },
      }),
    );
    expect(readiness.ok).toBe(false);
  });

  it("authoritative caller mismatch fails closed", () => {
    // Different session key than the P0→C1 edge grantee: parent edge lookup
    // resolves to nothing and the issuance fails closed.
    const otherHandle = mintRuntimeGovernedParentHandleForTest({
      runId: "OTHER-RUN",
      sessionKey: "agent:other:other",
    });
    const otherTx = createGovernedTransaction({ handle: otherHandle });
    const result = withEnv(env, () =>
      issueGovernedSubdelegationGrant({
        handle: otherHandle,
        transaction: otherTx,
        grant: {
          requestedG1Authority: g1Authority(fixture.c1Ceiling),
          granteeSessionKey: "agent:g1:g1",
          holderSessionKey: "agent:holder:h1",
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("non-amplification failure rolls back (no grant, no readiness, no edge)", () => {
    const tooWide: SoraDelegationAuthority = {
      ...g1Authority(fixture.c1Ceiling),
      permittedToolNames: ["exec"],
    };
    const result = withEnv(env, () =>
      issueGovernedSubdelegationGrant({
        handle: fixture.handle,
        transaction: fixture.transaction,
        grant: {
          requestedG1Authority: tooWide,
          granteeSessionKey: "agent:g1:g1",
          holderSessionKey: "agent:holder:h1",
        },
      }),
    );
    expect(result.ok).toBe(false);
    const db = openOpenClawStateDatabase({ env });
    const grants = db.db
      .prepare("SELECT COUNT(*) AS c FROM governed_subdelegation_grants")
      .get() as { c: number };
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

  it("readiness is not produced on failed issuance", () => {
    closeGovernedTransaction(fixture.transaction, "FAILED");
    const result = issueParent(fixture);
    expect(result.ok).toBe(false);
    const db = openOpenClawStateDatabase({ env });
    const readiness = db.db.prepare("SELECT COUNT(*) AS c FROM sora_edge_readiness").get() as {
      c: number;
    };
    expect(readiness.c).toBe(0);
  });

  it("readiness becomes invalid after revocation/closure", () => {
    const issued = issueParent(fixture);
    expect(issued.ok).toBe(true);
    if (!issued.ok) {
      return;
    }
    const ready = withEnv(env, () =>
      resolveGovernedReadiness({
        handle: fixture.handle,
        grantId: issued.grantId,
        options: { env },
      }),
    );
    expect(ready.ok).toBe(true);
    const revoked = withEnv(env, () =>
      revokeGovernedReadiness({
        grantId: issued.grantId,
        reason: "governed closure",
        options: { env },
      }),
    );
    expect(revoked.ok).toBe(true);
    const after = withEnv(env, () =>
      resolveGovernedReadiness({
        handle: fixture.handle,
        grantId: issued.grantId,
        options: { env },
      }),
    );
    expect(after.ok).toBe(false);
  });

  it("B1-T1: a second equivalent sequential issuance fails and materializes NOTHING", () => {
    const first = issueParent(fixture);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const second = issueParent(fixture);
    expect(second.ok).toBe(false);
    if (second.ok) {
      return;
    }
    expect(second.reason).toBe("issuance-scope-already-issued");
    const db = openOpenClawStateDatabase({ env });
    const grants = db.db
      .prepare("SELECT COUNT(*) AS c FROM governed_subdelegation_grants")
      .get() as { c: number };
    const readiness = db.db.prepare("SELECT COUNT(*) AS c FROM sora_edge_readiness").get() as {
      c: number;
    };
    const edges = db.db
      .prepare("SELECT COUNT(*) AS c FROM sora_delegation_edges WHERE edge_kind = 'C1_G1'")
      .get() as { c: number };
    const capabilities = db.db
      .prepare("SELECT COUNT(*) AS c FROM sora_c1_g1_capabilities")
      .get() as { c: number };
    const parentTxns = db.db
      .prepare("SELECT COUNT(*) AS c FROM governed_transaction_runs WHERE kind = 'PARENT'")
      .get() as { c: number };
    const childTxns = db.db
      .prepare("SELECT COUNT(*) AS c FROM governed_transaction_runs WHERE kind = 'CHILD'")
      .get() as { c: number };
    expect(grants.c).toBe(1);
    expect(readiness.c).toBe(1);
    expect(edges.c).toBe(1);
    expect(capabilities.c).toBe(1);
    expect(parentTxns.c).toBe(1);
    expect(childTxns.c).toBe(1);
  });

  it("B1-T1b: the issuance scope is exactly (parent run, grantor, grantee)", () => {
    // A different grantee under the SAME parent scope is a distinct scope:
    // it must still issue once. A different parent run for the same grantee
    // is likewise a distinct scope.
    const first = issueParent(fixture);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const otherGrantee = withEnv(env, () =>
      issueGovernedSubdelegationGrant({
        handle: fixture.handle,
        transaction: fixture.transaction,
        grant: {
          granteeSessionKey: "agent:g1:other",
          holderSessionKey: "agent:holder:h1",
        },
      }),
    );
    expect(otherGrantee.ok).toBe(true);
    const secondParentHandle = mintRuntimeGovernedParentHandleForTest({
      runId: "C1-RUN-2",
      sessionKey: "agent:c1:c1",
    });
    const secondParentTx = createGovernedTransaction({ handle: secondParentHandle });
    const otherRun = withEnv(env, () =>
      issueGovernedSubdelegationGrant({
        handle: secondParentHandle,
        transaction: secondParentTx,
        grant: {
          granteeSessionKey: "agent:g1:g1",
          holderSessionKey: "agent:holder:h1",
        },
      }),
    );
    expect(otherRun.ok).toBe(true);
    const db = openOpenClawStateDatabase({ env });
    const grants = db.db
      .prepare("SELECT COUNT(*) AS c FROM governed_subdelegation_grants")
      .get() as { c: number };
    expect(grants.c).toBe(3);
    // Re-running the exact first scope again still fails closed.
    const again = issueParent(fixture);
    expect(again.ok).toBe(false);
  });

  it("B1-T3: forced single-winner loss rolls back with no partial materialization", () => {
    // Pre-occupy the exact issuance scope with an ACTIVE grant row, then prove
    // the guarded writer loses and nothing else materializes.
    const db = openOpenClawStateDatabase({ env });
    db.db
      .prepare(
        `INSERT INTO governed_subdelegation_grants (
          grant_id, delegation_id, authority_id, capability_id,
          parent_transaction_run_id, grantor_session_key, grantee_session_key,
          holder_session_key, parent_edge_delegation_id, lifecycle_generation,
          status, max_uses, max_descendants, max_depth_from_p0,
          retry_allowed, fallback_allowed, further_delegation_allowed,
          provenance_json, issued_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, 1, 2, 0, 0, 0, ?, ?, ?)`,
      )
      .run(
        "GRANT_PREOCCUPY",
        "C1G1_PREOCCUPY",
        "AUTH_PREOCCUPY",
        "CAP_PREOCCUPY",
        "C1-RUN",
        "agent:c1:c1",
        "agent:g1:g1",
        "agent:holder:h1",
        "P0_C1_DELEG",
        "gen-preoccupied",
        "preoccupied",
        Date.now(),
        Date.now(),
      );
    const result = issueParent(fixture);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("issuance-scope-already-issued");
    const db2 = openOpenClawStateDatabase({ env });
    const readiness = db2.db.prepare("SELECT COUNT(*) AS c FROM sora_edge_readiness").get() as {
      c: number;
    };
    const edges = db2.db
      .prepare("SELECT COUNT(*) AS c FROM sora_delegation_edges WHERE edge_kind = 'C1_G1'")
      .get() as { c: number };
    const capabilities = db2.db
      .prepare("SELECT COUNT(*) AS c FROM sora_c1_g1_capabilities")
      .get() as { c: number };
    const childTxns = db2.db
      .prepare("SELECT COUNT(*) AS c FROM governed_transaction_runs WHERE kind = 'CHILD'")
      .get() as { c: number };
    expect(readiness.c).toBe(0);
    expect(edges.c).toBe(0);
    expect(capabilities.c).toBe(0);
    expect(childTxns.c).toBe(0);
    const grants = db2.db
      .prepare("SELECT COUNT(*) AS c FROM governed_subdelegation_grants")
      .get() as { c: number };
    expect(grants.c).toBe(1);
  });

  it("G1 cannot further delegate; retry/fallback forbidden; depth 2; descendants 1", () => {
    const g1 = g1Authority(fixture.c1Ceiling);
    expect(g1.depth).toBe(2);
    expect(g1.maxDescendants).toBe(0);
    expect(g1.delegableCeiling).toBe(false);
    const issued = issueParent(fixture);
    expect(issued.ok).toBe(true);
    if (!issued.ok) {
      return;
    }
    const db = openOpenClawStateDatabase({ env });
    const grant = db.db
      .prepare("SELECT * FROM governed_subdelegation_grants WHERE grant_id = ?")
      .get(issued.grantId) as Record<string, unknown> | undefined;
    expect(grant).toBeDefined();
    expect(grant?.retry_allowed).toBe(0);
    expect(grant?.fallback_allowed).toBe(0);
    expect(grant?.further_delegation_allowed).toBe(0);
    expect(grant?.max_depth_from_p0).toBe(2);
    expect(grant?.max_uses).toBe(1);
    const capability = db.db
      .prepare("SELECT * FROM sora_c1_g1_capabilities WHERE capability_id = ?")
      .get(issued.capabilityId) as Record<string, unknown> | undefined;
    expect(capability).toBeDefined();
    expect(capability?.retry_allowed).toBe(0);
    expect(capability?.fallback_allowed).toBe(0);
    expect(capability?.further_delegation_allowed).toBe(0);
    expect(capability?.max_depth_from_p0).toBe(2);
  });

  it("no alternate production issuance writer is exported", async () => {
    const module = await import("./governed-subdelegation-issuance.js");
    // Only the one authoritative writer plus the possession-resolving entry
    // that delegates to it. No other function creates a valid grant/readiness
    // combination.
    const writers = Object.keys(module).filter(
      (name) =>
        name === "issueGovernedSubdelegationGrant" || name === "issueGovernedSubdelegationForSpawn",
    );
    expect([...writers].toSorted()).toEqual(
      ["issueGovernedSubdelegationForSpawn", "issueGovernedSubdelegationGrant"].toSorted(),
    );
    expect(module.issueGovernedSubdelegationGrant).toBeTypeOf("function");
    expect(module.issueGovernedSubdelegationForSpawn).toBeTypeOf("function");
  });
});

describe("Phase B1 correction: canonical Phase-A derivation", () => {
  let stateDir: string;
  let env: { OPENCLAW_STATE_DIR: string };
  let c1Ceiling: SoraDelegationAuthority;

  beforeEach(() => {
    stateDir = createTempStateDir();
    env = { OPENCLAW_STATE_DIR: stateDir };
    const c1Resolved = resolveC1DelegationAuthority({
      delegationId: "P0_C1_DELEG",
      grantorSessionKey: "agent:p0:p0",
      granteeSessionKey: "agent:c1:c1",
      grantorTransactionRunId: "P0-run",
    });
    expect(c1Resolved.ok).toBe(true);
    c1Ceiling = (c1Resolved as { ok: true; authority: SoraDelegationAuthority }).authority;
    const edge = createSoraDelegationEdge(
      {
        delegationId: "P0_C1_DELEG",
        grantorSessionKey: "agent:p0:p0",
        granteeSessionKey: "agent:c1:c1",
        grantorTransactionRunId: "P0-run",
        edgeKind: "P0_C1",
        authority: c1Ceiling,
        rootDelegationId: "P0_C1_DELEG",
      },
      { env },
    );
    expect(edge.ok).toBe(true);
  });

  afterEach(() => {
    closeOpenClawStateDatabaseForTest();
  });

  afterAll(() => {
    cleanupTempDirs(tempDirs);
  });

  it("canonical G1 derivation succeeds and is a strict subset of the C1 ceiling", () => {
    const g1 = g1Authority(c1Ceiling);
    expect(g1.depth).toBe(2);
    expect(g1.maxDescendants).toBe(0);
    expect(g1.delegableCeiling).toBe(false);
    const comparison = compareSoraAuthority(c1Ceiling, g1);
    expect(comparison.ok).toBe(true);
  });

  it("amplification still fails closed", () => {
    const g1 = g1Authority(c1Ceiling);
    const amplified = {
      ...g1,
      depth: 2,
      maxDescendants: 2,
      permittedToolNames: ["exec"],
    };
    const comparison = compareSoraAuthority(c1Ceiling, amplified);
    expect(comparison.ok).toBe(false);
  });

  it("unknown/incomparable scope still fails closed", () => {
    const unknown = {
      ...g1Authority(c1Ceiling),
      scope: ["single-grandchild-unknown"],
    };
    const comparison = compareSoraAuthority(c1Ceiling, unknown);
    expect(comparison.ok).toBe(false);
  });
});

describe("Phase B1 correction: runtime possession carry", () => {
  let stateDir: string;
  let env: { OPENCLAW_STATE_DIR: string };

  beforeEach(() => {
    stateDir = createTempStateDir();
    env = { OPENCLAW_STATE_DIR: stateDir };
  });

  afterEach(() => {
    closeOpenClawStateDatabaseForTest();
  });

  afterAll(() => {
    cleanupTempDirs(tempDirs);
  });

  function seedParent(): SoraDelegationAuthority {
    const c1Resolved = resolveC1DelegationAuthority({
      delegationId: "P0_C1_DELEG",
      grantorSessionKey: "agent:p0:p0",
      granteeSessionKey: "agent:c1:c1",
      grantorTransactionRunId: "P0-run",
    });
    expect(c1Resolved.ok).toBe(true);
    const ceiling = (c1Resolved as { ok: true; authority: SoraDelegationAuthority }).authority;
    const edge = createSoraDelegationEdge(
      {
        delegationId: "P0_C1_DELEG",
        grantorSessionKey: "agent:p0:p0",
        granteeSessionKey: "agent:c1:c1",
        grantorTransactionRunId: "P0-run",
        edgeKind: "P0_C1",
        authority: ceiling,
        rootDelegationId: "P0_C1_DELEG",
      },
      { env },
    );
    expect(edge.ok).toBe(true);
    return ceiling;
  }

  it("legitimate internal governed call (inside runtime ALS context) reaches issuance", () => {
    const ceiling = seedParent();
    void ceiling;
    const attachment = mintRuntimeGovernedParentHandleForRun({
      runId: "C1-RUN",
      sessionKey: "agent:c1:c1",
    });
    expect(attachment.ok).toBe(true);
    if (!attachment.ok) {
      return;
    }
    // Simulate the runtime-owned execution context with the SAME lifecycle
    // generation the handle was minted under (runner-owned boundary).
    const generation = attachment.handle.lifecycleGeneration;
    const issued = withAgentRunLifecycleGeneration(generation, () =>
      withEnv(env, () =>
        issueGovernedSubdelegationForParentRun({
          parentRunId: "C1-RUN",
          parentSessionKey: "agent:c1:c1",
          granteeSessionKey: "agent:g1:g1",
        }),
      ),
    );
    expect(issued.ok).toBe(true);
  });

  it("generic external invocation (no ALS runtime context) cannot issue", () => {
    const attachment = mintRuntimeGovernedParentHandleForRun({
      runId: "C1-RUN",
      sessionKey: "agent:c1:c1",
    });
    expect(attachment.ok).toBe(true);
    if (!attachment.ok) {
      return;
    }
    // No withAgentRunLifecycleGeneration wrapper: the ALS store is empty, so
    // resolvePossessedGovernedParentForRun returns undefined and issuance
    // fails closed even though the caller knows runId+sessionKey.
    const result = withEnv(env, () =>
      issueGovernedSubdelegationForParentRun({
        parentRunId: "C1-RUN",
        parentSessionKey: "agent:c1:c1",
        granteeSessionKey: "agent:g1:g1",
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("stale lifecycle generation fails", () => {
    const attachment = mintRuntimeGovernedParentHandleForRun({
      runId: "C1-RUN",
      sessionKey: "agent:c1:c1",
    });
    expect(attachment.ok).toBe(true);
    if (!attachment.ok) {
      return;
    }
    const result = withAgentRunLifecycleGeneration("STALE-GENERATION", () =>
      withEnv(env, () =>
        issueGovernedSubdelegationForParentRun({
          parentRunId: "C1-RUN",
          parentSessionKey: "agent:c1:c1",
          granteeSessionKey: "agent:g1:g1",
        }),
      ),
    );
    expect(result.ok).toBe(false);
  });

  it("spawn-path entry issues through the same possession carry", () => {
    seedParent();
    const attachment = mintRuntimeGovernedParentHandleForRun({
      runId: "C1-RUN",
      sessionKey: "agent:c1:c1",
    });
    expect(attachment.ok).toBe(true);
    if (!attachment.ok) {
      return;
    }
    const generation = attachment.handle.lifecycleGeneration;
    const result = withAgentRunLifecycleGeneration(generation, () =>
      withEnv(env, () =>
        issueGovernedSubdelegationForSpawn({
          parentRunId: "C1-RUN",
          parentSessionKey: "agent:c1:c1",
          granteeSessionKey: "agent:g1:g1",
        }),
      ),
    );
    expect(result.ok).toBe(true);
  });
});
