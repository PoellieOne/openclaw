/**
 * Closure-proof focused tests (Blocker B + Blocker C2).
 *
 * Standing delegation authority is liveness-based: consumed/closed/revoked
 * instruments are historical structure, not standing authority. The final
 * closure predicate enforces every mandated proof condition, including
 * canonicalization-grant accounting: a usable (unused, unrevoked, live-edge)
 * grant is standing authority and blocks closure; used/revoked/effectively-
 * revoked grants are historical; dangling/malformed grant evidence fails
 * closed.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../../test/helpers/temp-dir.js";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
} from "../../state/openclaw-state-db.js";
import { withEnv } from "../../test-utils/env.js";
import { saveSubagentRegistryToSqlite } from "../subagent-registry.store.sqlite.js";
import type { SubagentRunRecord } from "../subagent-registry.types.js";
import { resolveSoraMinimalTreeClosureProof, type SoraClosureProof } from "./closure-proof.js";
import {
  SORA_C1_G1_MAX_DEPTH_FROM_P0,
  SORA_MINIMAL_TREE_ROUTE_ID,
  SORA_P0_C1_MAX_DEPTH,
  type SoraDelegationAuthority,
} from "./store.js";

const tempDirs: string[] = [];
const ROOT_DELEGATION_ID = "ROOT_DELEGATION";
const C1_SESSION = "agent:c1:c1";
const C1_GRANTOR_TX = "P0-transaction-1";
const C1_GRANTEE_TX = "C1-transaction-1";

function createTempStateDir(): string {
  return makeTempDir(tempDirs, "openclaw-sora-closure-");
}

function makeAuthority(params: {
  depth: number;
  maxDescendants: number;
  delegableCeiling: boolean;
}): SoraDelegationAuthority {
  return {
    routeId: SORA_MINIMAL_TREE_ROUTE_ID,
    depth: params.depth,
    maxDescendants: params.maxDescendants,
    permittedToolNames: [],
    mutationNames: [],
    scope: [],
    executorKind: ["openclaw-subagent"],
    runtimeRoute: ["embedded-subagent"],
    delegableCeiling: params.delegableCeiling,
  };
}

function insertEdge(
  db: DatabaseSync,
  params: {
    delegationId: string;
    parentDelegationId?: string;
    grantorSessionKey: string;
    granteeSessionKey: string;
    grantorTransactionRunId: string;
    granteeTransactionRunId?: string;
    edgeKind: "P0_C1" | "C1_G1";
    depth: number;
    authority: SoraDelegationAuthority;
    retryAllowed?: number;
    fallbackAllowed?: number;
    furtherDelegationAllowed?: number;
    revocationReason?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO sora_delegation_edges (
       delegation_id, authority_id, parent_delegation_id, root_delegation_id,
       grantor_session_key, grantee_session_key, grantor_transaction_run_id,
       grantee_transaction_run_id, edge_kind, depth, authority_json,
       retry_allowed, fallback_allowed, further_delegation_allowed,
       revocation_reason, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    params.delegationId,
    `AUTH_${params.delegationId}`,
    params.parentDelegationId ?? null,
    ROOT_DELEGATION_ID,
    params.grantorSessionKey,
    params.granteeSessionKey,
    params.grantorTransactionRunId,
    params.granteeTransactionRunId ?? null,
    params.edgeKind,
    params.depth,
    JSON.stringify(params.authority),
    params.retryAllowed ?? 0,
    params.fallbackAllowed ?? 0,
    params.furtherDelegationAllowed ?? 0,
    params.revocationReason ?? null,
    100,
    100,
  );
}

function insertCapability(
  db: DatabaseSync,
  params: {
    capabilityId: string;
    delegationId: string;
    issueDelegationId: string;
    grantorSessionKey: string;
    granteeSessionKey: string;
    transactionRunId: string;
    consumed: boolean;
    retryAllowed?: number;
    fallbackAllowed?: number;
    furtherDelegationAllowed?: number;
  },
): void {
  db.prepare(
    `INSERT INTO sora_c1_g1_capabilities (
       capability_id, delegation_id, authority_id, issue_delegation_id, issue_authority_id,
       grantor_session_key, grantee_session_key, transaction_run_id,
       max_uses, max_descendants, max_depth_from_p0,
       retry_allowed, fallback_allowed, further_delegation_allowed,
       consumed, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 2, ?, ?, ?, ?, 100, 100)`,
  ).run(
    params.capabilityId,
    params.delegationId,
    `AUTH_CAP_${params.capabilityId}`,
    params.issueDelegationId,
    `AUTH_${params.issueDelegationId}`,
    params.grantorSessionKey,
    params.granteeSessionKey,
    params.transactionRunId,
    params.retryAllowed ?? 0,
    params.fallbackAllowed ?? 0,
    params.furtherDelegationAllowed ?? 0,
    params.consumed ? 1 : 0,
  );
}

function insertIntegration(
  db: DatabaseSync,
  params: {
    integrationId: string;
    delegationId: string;
    kind: "P0_C1" | "C1_G1";
    childResultSessionKey: string;
    childResultRunId: string;
    originatingTransactionRunId: string;
    parentSessionKey: string;
    parentTransactionRunId: string;
    resultDigest: string;
    classification: "ACCEPTED" | "REJECTED" | "PENDING";
    integrationStatus: "TRANSPORT_RECEIVED" | "CLASSIFIED" | "INTEGRATED" | "REJECTED";
    canonicalized?: number;
  },
): void {
  db.prepare(
    `INSERT INTO sora_integration_objects (
       integration_id, delegation_id, authority_id, kind,
       child_result_session_key, child_result_run_id, originating_transaction_run_id,
       parent_session_key, parent_transaction_run_id, result_digest,
       classification, integration_status, parent_result_changed, parent_result_change_summary,
       canonicalized, canonicalized_at, provenance_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, '{}', 100, 100)`,
  ).run(
    params.integrationId,
    params.delegationId,
    `AUTH_INT_${params.integrationId}`,
    params.kind,
    params.childResultSessionKey,
    params.childResultRunId,
    params.originatingTransactionRunId,
    params.parentSessionKey,
    params.parentTransactionRunId,
    params.resultDigest,
    params.classification,
    params.integrationStatus,
    params.canonicalized ?? 0,
  );
}

function insertGrant(
  db: DatabaseSync,
  params: {
    grantId: string;
    integrationId: string;
    delegationId: string;
    authorityId: string;
    rootDelegationId: string;
    parentSessionKey: string;
    parentTransactionRunId: string;
    resultDigest: string;
    revokesEdgeDelegationId?: string;
    used?: number;
    revoked?: number;
  },
): void {
  db.prepare(
    `INSERT INTO sora_canonicalization_grants (
       grant_id, integration_id, delegation_id, authority_id, root_delegation_id,
       parent_session_key, parent_transaction_run_id, result_digest,
       revokes_edge_delegation_id, used, revoked, used_at, revoked_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 100, 100)`,
  ).run(
    params.grantId,
    params.integrationId,
    params.delegationId,
    params.authorityId,
    params.rootDelegationId,
    params.parentSessionKey,
    params.parentTransactionRunId,
    params.resultDigest,
    params.revokesEdgeDelegationId ?? null,
    params.used ?? 0,
    params.revoked ?? 0,
  );
}

function insertRunningSubagentRun(stateDir: string, controllerSessionKey: string): void {
  const record: SubagentRunRecord = {
    runId: "run-live-descendant",
    childSessionKey: "agent:g1:g1",
    controllerSessionKey,
    requesterSessionKey: C1_SESSION,
    requesterDisplayKey: "c1",
    task: "descendant task",
    cleanup: "delete",
    createdAt: 100,
    startedAt: 110,
    execution: { status: "running", acceptedAt: 100, startedAt: 110 },
    completion: { required: true },
    delivery: { status: "not_required" },
  };
  withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
    saveSubagentRegistryToSqlite(new Map([[record.runId, record]]));
  });
}

function insertSubagentRun(
  stateDir: string,
  params: {
    runId: string;
    controllerSessionKey: string;
    execution: SubagentRunRecord["execution"];
  },
): void {
  const record: SubagentRunRecord = {
    runId: params.runId,
    childSessionKey: `agent:g1:${params.runId}`,
    controllerSessionKey: params.controllerSessionKey,
    requesterSessionKey: C1_SESSION,
    requesterDisplayKey: "c1",
    task: "descendant task",
    cleanup: "delete",
    createdAt: 100,
    execution: params.execution,
    completion: { required: true },
    delivery: { status: "not_required" },
  };
  withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
    saveSubagentRegistryToSqlite(new Map([[record.runId, record]]));
  });
}

function buildValidLifecycle(): {
  p0C1DelegationId: string;
  c1G1DelegationId: string;
  capabilityId: string;
  g1IntegrationId: string;
  p0IntegrationId: string;
} {
  return {
    p0C1DelegationId: "P0_C1_DELEGATION_TEST",
    c1G1DelegationId: "C1_G1_DELEGATION_TEST",
    capabilityId: "CAPABILITY_TEST",
    g1IntegrationId: "INTEGRATION_G1_TEST",
    p0IntegrationId: "INTEGRATION_P0_TEST",
  };
}

function seedValidLifecycle(stateDir: string): ReturnType<typeof buildValidLifecycle> {
  const ids = buildValidLifecycle();
  withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
    const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
    insertEdge(db, {
      delegationId: ids.p0C1DelegationId,
      grantorSessionKey: "agent:main:main",
      granteeSessionKey: C1_SESSION,
      grantorTransactionRunId: C1_GRANTOR_TX,
      granteeTransactionRunId: C1_GRANTEE_TX,
      edgeKind: "P0_C1",
      depth: SORA_P0_C1_MAX_DEPTH,
      authority: makeAuthority({
        depth: SORA_P0_C1_MAX_DEPTH,
        maxDescendants: 1,
        delegableCeiling: true,
      }),
    });
    insertEdge(db, {
      delegationId: ids.c1G1DelegationId,
      parentDelegationId: ids.p0C1DelegationId,
      grantorSessionKey: C1_SESSION,
      granteeSessionKey: "agent:g1:g1",
      grantorTransactionRunId: C1_GRANTEE_TX,
      granteeTransactionRunId: "G1-transaction-1",
      edgeKind: "C1_G1",
      depth: SORA_C1_G1_MAX_DEPTH_FROM_P0,
      authority: makeAuthority({
        depth: SORA_C1_G1_MAX_DEPTH_FROM_P0,
        maxDescendants: 0,
        delegableCeiling: false,
      }),
    });
    insertCapability(db, {
      capabilityId: ids.capabilityId,
      delegationId: ids.c1G1DelegationId,
      issueDelegationId: ids.p0C1DelegationId,
      grantorSessionKey: C1_SESSION,
      granteeSessionKey: "agent:g1:g1",
      transactionRunId: C1_GRANTEE_TX,
      consumed: true,
    });
    insertIntegration(db, {
      integrationId: ids.g1IntegrationId,
      delegationId: ids.c1G1DelegationId,
      kind: "C1_G1",
      childResultSessionKey: "agent:g1:g1",
      childResultRunId: "G1-transaction-1",
      originatingTransactionRunId: "G1-transaction-1",
      parentSessionKey: C1_SESSION,
      parentTransactionRunId: C1_GRANTEE_TX,
      resultDigest: "digest-g1",
      classification: "ACCEPTED",
      integrationStatus: "CLASSIFIED",
    });
    insertIntegration(db, {
      integrationId: ids.p0IntegrationId,
      delegationId: ids.p0C1DelegationId,
      kind: "P0_C1",
      childResultSessionKey: C1_SESSION,
      childResultRunId: C1_GRANTEE_TX,
      originatingTransactionRunId: C1_GRANTEE_TX,
      parentSessionKey: "agent:main:main",
      parentTransactionRunId: C1_GRANTOR_TX,
      resultDigest: "digest-c1",
      classification: "ACCEPTED",
      integrationStatus: "CLASSIFIED",
    });
  });
  return ids;
}

function runProof(stateDir: string): SoraClosureProof {
  let proof!: SoraClosureProof;
  withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
    proof = resolveSoraMinimalTreeClosureProof({
      rootDelegationId: ROOT_DELEGATION_ID,
      c1SessionKey: C1_SESSION,
      options: { env: { OPENCLAW_STATE_DIR: stateDir } },
    });
  });
  return proof;
}

describe("resolveSoraMinimalTreeClosureProof", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = createTempStateDir();
  });

  afterEach(() => {
    closeOpenClawStateDatabaseForTest();
  });

  afterAll(() => {
    cleanupTempDirs(tempDirs);
  });

  it("case 1: live (unconsumed) C1 delegation authority -> closure FAIL", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      db.prepare("UPDATE sora_c1_g1_capabilities SET consumed = 0 WHERE capability_id = ?").run(
        ids.capabilityId,
      );
    });
    const proof = runProof(stateDir);
    expect(proof.standingDelegationAuthority).toBeGreaterThan(0);
    expect(proof.closureComplete).toBe(false);
  });

  it("case 2: historical/closed consumed C1 delegation structure does not itself block closure", () => {
    seedValidLifecycle(stateDir);
    const proof = runProof(stateDir);
    expect(proof.standingDelegationAuthority).toBe(0);
    expect(proof.closureComplete).toBe(true);
  });

  it("case 3: retryCount > 0 -> closure FAIL", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      db.prepare(
        "UPDATE sora_c1_g1_capabilities SET retry_allowed = 1 WHERE capability_id = ?",
      ).run(ids.capabilityId);
    });
    const proof = runProof(stateDir);
    expect(proof.retryCount).toBe(1);
    expect(proof.closureComplete).toBe(false);
  });

  it("case 4: fallbackCount > 0 -> closure FAIL", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      db.prepare(
        "UPDATE sora_c1_g1_capabilities SET fallback_allowed = 1 WHERE capability_id = ?",
      ).run(ids.capabilityId);
    });
    const proof = runProof(stateDir);
    expect(proof.fallbackCount).toBe(1);
    expect(proof.closureComplete).toBe(false);
  });

  it("case 5: capabilityUseCount != 1 -> closure FAIL", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      insertCapability(db, {
        capabilityId: "CAPABILITY_SECOND",
        delegationId: "C1_G1_DELEGATION_SECOND",
        issueDelegationId: ids.p0C1DelegationId,
        grantorSessionKey: C1_SESSION,
        granteeSessionKey: "agent:g1:g1b",
        transactionRunId: C1_GRANTEE_TX,
        consumed: true,
      });
      insertEdge(db, {
        delegationId: "C1_G1_DELEGATION_SECOND",
        parentDelegationId: ids.p0C1DelegationId,
        grantorSessionKey: C1_SESSION,
        granteeSessionKey: "agent:g1:g1b",
        grantorTransactionRunId: C1_GRANTEE_TX,
        granteeTransactionRunId: "G1-transaction-2",
        edgeKind: "C1_G1",
        depth: SORA_C1_G1_MAX_DEPTH_FROM_P0,
        authority: makeAuthority({
          depth: SORA_C1_G1_MAX_DEPTH_FROM_P0,
          maxDescendants: 0,
          delegableCeiling: false,
        }),
      });
    });
    const proof = runProof(stateDir);
    expect(proof.capabilityUseCount).toBe(2);
    expect(proof.closureComplete).toBe(false);
  });

  it("case 6: unexpectedSpawnCount > 0 -> closure FAIL", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      insertEdge(db, {
        delegationId: "C1_G1_DELEGATION_EXTRA",
        parentDelegationId: ids.p0C1DelegationId,
        grantorSessionKey: C1_SESSION,
        granteeSessionKey: "agent:g1:g1b",
        grantorTransactionRunId: C1_GRANTEE_TX,
        granteeTransactionRunId: "G1-transaction-extra",
        edgeKind: "C1_G1",
        depth: SORA_C1_G1_MAX_DEPTH_FROM_P0,
        authority: makeAuthority({
          depth: SORA_C1_G1_MAX_DEPTH_FROM_P0,
          maxDescendants: 0,
          delegableCeiling: false,
        }),
      });
    });
    const proof = runProof(stateDir);
    expect(proof.unexpectedSpawnCount).toBe(1);
    expect(proof.closureComplete).toBe(false);
  });

  it("case 7: open descendant transaction -> closure FAIL", () => {
    seedValidLifecycle(stateDir);
    insertRunningSubagentRun(stateDir, C1_SESSION);
    const proof = runProof(stateDir);
    expect(proof.openDescendantTransactionCount).toBeGreaterThan(0);
    expect(proof.closureComplete).toBe(false);
  });

  it("case 7b: queued descendant -> closure FAIL", () => {
    seedValidLifecycle(stateDir);
    insertSubagentRun(stateDir, {
      runId: "run-queued-descendant",
      controllerSessionKey: C1_SESSION,
      execution: { status: "queued", acceptedAt: 100 },
    });
    const proof = runProof(stateDir);
    expect(proof.openDescendantTransactionCount).toBeGreaterThan(0);
    expect(proof.closureComplete).toBe(false);
  });

  it("case 7c: interrupted descendant -> closure FAIL (non-terminal/resumable)", () => {
    seedValidLifecycle(stateDir);
    insertSubagentRun(stateDir, {
      runId: "run-interrupted-descendant",
      controllerSessionKey: C1_SESSION,
      execution: {
        status: "interrupted",
        acceptedAt: 100,
        startedAt: 110,
        interruptedAt: 120,
        interruptionReason: "gateway-restart",
      },
    });
    const proof = runProof(stateDir);
    expect(proof.openDescendantTransactionCount).toBeGreaterThan(0);
    expect(proof.closureComplete).toBe(false);
  });

  it("case 7d: terminal descendant does not itself block closure", () => {
    seedValidLifecycle(stateDir);
    insertSubagentRun(stateDir, {
      runId: "run-terminal-descendant",
      controllerSessionKey: C1_SESSION,
      execution: { status: "terminal", acceptedAt: 100, startedAt: 110, endedAt: 200 },
    });
    const proof = runProof(stateDir);
    expect(proof.openDescendantTransactionCount).toBe(0);
    expect(proof.closureComplete).toBe(true);
  });

  it("case 7e: unknown/non-recognized descendant execution state fails closed at the store boundary", () => {
    // The real registry store enforces the canonical execution status union
    // (`queued | running | interrupted | terminal`); an unknown status can
    // never be persisted, so closure can never see one. This is the runtime's
    // authoritative fail-closed mechanism, verified here rather than cloning
    // the classifier: persistence is rejected before any DB write.
    const unknownRun: SubagentRunRecord = {
      runId: "run-unknown-descendant",
      childSessionKey: "agent:g1:unknown",
      controllerSessionKey: C1_SESSION,
      requesterSessionKey: C1_SESSION,
      requesterDisplayKey: "c1",
      task: "descendant task",
      cleanup: "delete",
      createdAt: 100,
      execution: { status: "suspended-mystery" } as SubagentRunRecord["execution"],
      completion: { required: true },
      delivery: { status: "not_required" },
    };
    expect(() => {
      withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
        saveSubagentRegistryToSqlite(new Map([[unknownRun.runId, unknownRun]]));
      });
    }).toThrow();
    // With no run persisted, the closure proof itself still resolves and a
    // valid lifecycle closes cleanly.
    seedValidLifecycle(stateDir);
    const proof = runProof(stateDir);
    expect(proof.openDescendantTransactionCount).toBe(0);
    expect(proof.closureComplete).toBe(true);
  });

  it("case 7f: absent descendant execution state fails closed at the store boundary", () => {
    // Execution state is required canonical nested state; a run without it is
    // rejected by the real store before any DB write.
    const missingExecutionRun: SubagentRunRecord = {
      runId: "run-no-execution-descendant",
      childSessionKey: "agent:g1:noexec",
      controllerSessionKey: C1_SESSION,
      requesterSessionKey: C1_SESSION,
      requesterDisplayKey: "c1",
      task: "descendant task",
      cleanup: "delete",
      createdAt: 100,
      completion: { required: true },
      delivery: { status: "not_required" },
    };
    expect(() => {
      withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
        saveSubagentRegistryToSqlite(new Map([[missingExecutionRun.runId, missingExecutionRun]]));
      });
    }).toThrow();
    // The closure predicate itself also counts any non-terminal state open
    // (defense-in-depth for future status additions), proven by the queued /
    // running / interrupted cases above and the terminal case below.
  });

  it("case 8: depth > 2 -> closure FAIL", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      db.prepare("UPDATE sora_delegation_edges SET depth = 3 WHERE delegation_id = ?").run(
        ids.c1G1DelegationId,
      );
    });
    const proof = runProof(stateDir);
    expect(proof.maxObservedDepth).toBe(3);
    expect(proof.closureComplete).toBe(false);
  });

  it("case 9: missing/pending integration -> closure FAIL", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      db.prepare("DELETE FROM sora_integration_objects WHERE integration_id = ?").run(
        ids.g1IntegrationId,
      );
    });
    const proof = runProof(stateDir);
    expect(proof.g1IntegrationState).toBe("NONE");
    expect(proof.closureComplete).toBe(false);
  });

  it("case 9b: P0_C1 integration missing -> closure FAIL", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      db.prepare("DELETE FROM sora_integration_objects WHERE integration_id = ?").run(
        ids.p0IntegrationId,
      );
    });
    const proof = runProof(stateDir);
    expect(proof.p0C1IntegrationState).toBe("NONE");
    expect(proof.closureComplete).toBe(false);
  });

  it("case 9c: PENDING (transport-received) integration -> closure FAIL", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      db.prepare(
        `UPDATE sora_integration_objects
           SET classification = 'PENDING', integration_status = 'TRANSPORT_RECEIVED'
           WHERE integration_id = ?`,
      ).run(ids.g1IntegrationId);
    });
    const proof = runProof(stateDir);
    expect(proof.g1IntegrationState).toBe("TRANSPORT_RECEIVED");
    expect(proof.closureComplete).toBe(false);
  });

  it("case 10: complete valid bottom-up lifecycle -> closure PASS", () => {
    seedValidLifecycle(stateDir);
    const proof = runProof(stateDir);
    expect(proof.closureComplete).toBe(true);
  });

  it("case 11: valid lifecycle + live unused grant -> closure FAIL (usable grant = standing authority)", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      insertGrant(db, {
        grantId: "GRANT_LIVE",
        integrationId: ids.p0IntegrationId,
        delegationId: ids.p0C1DelegationId,
        authorityId: "AUTH_P0_C1_DELEGATION_TEST",
        rootDelegationId: ROOT_DELEGATION_ID,
        parentSessionKey: "agent:main:main",
        parentTransactionRunId: C1_GRANTOR_TX,
        resultDigest: "digest-c1",
        revokesEdgeDelegationId: ids.p0C1DelegationId,
      });
    });
    const proof = runProof(stateDir);
    expect(proof.liveCanonicalizationGrantCount).toBe(1);
    expect(proof.standingDelegationAuthority).toBeGreaterThan(0);
    expect(proof.closureComplete).toBe(false);
  });

  it("case 12: valid lifecycle + used grant -> grant does not itself block closure", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      insertGrant(db, {
        grantId: "GRANT_USED",
        integrationId: ids.p0IntegrationId,
        delegationId: ids.p0C1DelegationId,
        authorityId: "AUTH_P0_C1_DELEGATION_TEST",
        rootDelegationId: ROOT_DELEGATION_ID,
        parentSessionKey: "agent:main:main",
        parentTransactionRunId: C1_GRANTOR_TX,
        resultDigest: "digest-c1",
        revokesEdgeDelegationId: ids.p0C1DelegationId,
        used: 1,
      });
    });
    const proof = runProof(stateDir);
    expect(proof.usedCanonicalizationGrantCount).toBe(1);
    expect(proof.liveCanonicalizationGrantCount).toBe(0);
    expect(proof.closureComplete).toBe(true);
  });

  it("case 13: valid lifecycle + revoked grant -> grant does not itself block closure", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      insertGrant(db, {
        grantId: "GRANT_REVOKED",
        integrationId: ids.p0IntegrationId,
        delegationId: ids.p0C1DelegationId,
        authorityId: "AUTH_P0_C1_DELEGATION_TEST",
        rootDelegationId: ROOT_DELEGATION_ID,
        parentSessionKey: "agent:main:main",
        parentTransactionRunId: C1_GRANTOR_TX,
        resultDigest: "digest-c1",
        revokesEdgeDelegationId: ids.p0C1DelegationId,
        revoked: 1,
      });
    });
    const proof = runProof(stateDir);
    expect(proof.revokedCanonicalizationGrantCount).toBe(1);
    expect(proof.liveCanonicalizationGrantCount).toBe(0);
    expect(proof.closureComplete).toBe(true);
  });

  it("case 14: unused grant + revoked parent edge -> effectively revoked, not standing authority", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      insertGrant(db, {
        grantId: "GRANT_EFFECTIVELY_REVOKED",
        integrationId: ids.p0IntegrationId,
        delegationId: ids.p0C1DelegationId,
        authorityId: "AUTH_P0_C1_DELEGATION_TEST",
        rootDelegationId: ROOT_DELEGATION_ID,
        parentSessionKey: "agent:main:main",
        parentTransactionRunId: C1_GRANTOR_TX,
        resultDigest: "digest-c1",
        revokesEdgeDelegationId: ids.p0C1DelegationId,
      });
      db.prepare(
        "UPDATE sora_delegation_edges SET revocation_reason = ? WHERE delegation_id = ?",
      ).run("revoked", ids.p0C1DelegationId);
    });
    const proof = runProof(stateDir);
    expect(proof.effectivelyRevokedCanonicalizationGrantCount).toBe(1);
    expect(proof.liveCanonicalizationGrantCount).toBe(0);
    expect(proof.closureComplete).toBe(false);
  });

  it("case 15: dangling grant (missing edge) -> closure FAIL CLOSED", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      insertGrant(db, {
        grantId: "GRANT_DANGLING",
        integrationId: ids.p0IntegrationId,
        delegationId: "MISSING_EDGE_DELEGATION",
        authorityId: "AUTH_MISSING_EDGE",
        rootDelegationId: ROOT_DELEGATION_ID,
        parentSessionKey: "agent:main:main",
        parentTransactionRunId: C1_GRANTOR_TX,
        resultDigest: "digest-c1",
      });
    });
    const proof = runProof(stateDir);
    expect(proof.danglingCanonicalizationGrantCount).toBe(1);
    expect(proof.closureComplete).toBe(false);
  });

  it("case 16: malformed grant evidence -> closure FAIL CLOSED", () => {
    const ids = seedValidLifecycle(stateDir);
    withEnv({ OPENCLAW_STATE_DIR: stateDir }, () => {
      const { db } = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
      // A grant row with an empty required binding field passes NOT NULL but
      // cannot be parsed into a record; it must count as malformed evidence
      // and fail closure.
      db.prepare(
        `INSERT INTO sora_canonicalization_grants (
           grant_id, integration_id, delegation_id, authority_id, root_delegation_id,
           parent_session_key, parent_transaction_run_id, result_digest,
           used, revoked, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, '', ?, ?, 0, 0, 100, 100)`,
      ).run(
        "GRANT_MALFORMED",
        ids.p0IntegrationId,
        ids.p0C1DelegationId,
        "AUTH_P0_C1_DELEGATION_TEST",
        ROOT_DELEGATION_ID,
        C1_GRANTOR_TX,
        "digest-c1",
      );
    });
    const proof = runProof(stateDir);
    expect(proof.totalCanonicalizationGrantCount).toBe(1);
    expect(proof.liveCanonicalizationGrantCount).toBe(0);
    expect(proof.closureComplete).toBe(false);
  });

  it("case 17: complete valid lifecycle with zero usable grants -> closure PASS", () => {
    seedValidLifecycle(stateDir);
    const proof = runProof(stateDir);
    expect(proof.totalCanonicalizationGrantCount).toBe(0);
    expect(proof.liveCanonicalizationGrantCount).toBe(0);
    expect(proof.closureComplete).toBe(true);
  });
});
