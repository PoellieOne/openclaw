/**
 * Canonicalization authority + sealed grant-issuance tests (Blocker C1/A.7/A.9).
 *
 * Canonicalization is an authority-possession check: the transaction re-loads
 * the exact live delegation edge and the single-purpose canonicalization grant
 * inside the same SQLite write lock as the canonicalization mutation.
 *
 * GRANT ISSUANCE IS SEALED IN PHASE A (A.9): there is no exported,
 * importable, or callable grant-issuance function. The trusted
 * caller-provenance chain (server-injected session identity AND a governed
 * transaction identity with an existing producer) does not exist in Phase-A
 * source, so any caller-supplied identity would remain fabricable
 * (`TYPED_CONTEXT != TRUSTED_CONTEXT`). The enforced invariant is
 * `NO_TRUSTED_TRANSACTION_CONTEXT -> NO_GRANT_ISSUANCE`: an ordinary internal
 * caller cannot mint a grant from row-readable values, because no issuance
 * API exists at all. Grant rows used by the canonicalization/revocation tests
 * below are seeded with raw SQLite writes — the trusted-computing-base
 * stand-in for the future governed Phase-B issuance seam.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../../test/helpers/temp-dir.js";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
} from "../../state/openclaw-state-db.js";
import { withEnv } from "../../test-utils/env.js";
import { createSoraDelegationEdge } from "./delegation-edge.js";
import * as integrationObjectsModule from "./integration-objects.js";
import {
  classifySoraIntegration,
  createSoraIntegrationObject,
  markSoraIntegrationCanonicalized,
  revokeSoraDelegationEdgeAndGrants,
  type SoraCanonicalizationAuthorityBinding,
} from "./integration-objects.js";
import {
  SORA_C1_G1_MAX_DEPTH_FROM_P0,
  SORA_MINIMAL_TREE_ROUTE_ID,
  SORA_P0_C1_MAX_DEPTH,
  type SoraDelegationAuthority,
} from "./store.js";

const tempDirs: string[] = [];
const ROOT_DELEGATION_ID = "ROOT_DELEGATION";
const PARENT_SESSION = "agent:main:main";
const PARENT_TX = "P0-transaction-1";
const C1_SESSION = "agent:c1:c1";
const C1_TX = "C1-transaction-1";
const DIGEST = "digest-c1";

function createTempStateDir(): string {
  return makeTempDir(tempDirs, "openclaw-sora-canonicalize-");
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

type Seeded = {
  env: { OPENCLAW_STATE_DIR: string };
  integrationId: string;
  delegationId: string;
  authorityId: string;
  grantId: string;
  binding: SoraCanonicalizationAuthorityBinding;
};

/** Raw grant-row seeding (test-only TCB stand-in for the sealed Phase-B issuance seam). */
function seedGrantRow(
  env: { OPENCLAW_STATE_DIR: string },
  params: {
    grantId: string;
    integrationId: string;
    delegationId: string;
    authorityId: string;
    parentSessionKey: string;
    parentTransactionRunId: string;
    resultDigest: string;
    rootDelegationId?: string;
    used?: number;
    revoked?: number;
  },
): void {
  withEnv(env, () => {
    openOpenClawStateDatabase({ env })
      .db.prepare(
        `INSERT INTO sora_canonicalization_grants (
           grant_id, integration_id, delegation_id, authority_id, root_delegation_id,
           parent_session_key, parent_transaction_run_id, result_digest,
           revokes_edge_delegation_id, used, revoked, used_at, revoked_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 100, 100)`,
      )
      .run(
        params.grantId,
        params.integrationId,
        params.delegationId,
        params.authorityId,
        params.rootDelegationId ?? ROOT_DELEGATION_ID,
        params.parentSessionKey,
        params.parentTransactionRunId,
        params.resultDigest,
        params.delegationId,
        params.used ?? 0,
        params.revoked ?? 0,
      );
  });
}

describe("sealed grant-issuance surface (Phase-A.9)", () => {
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

  it("no callable grant-issuance API is exported", () => {
    // The A.7/A.8 issuance surface (creator + issuer context + params type)
    // must be entirely absent from the module's public exports.
    expect(integrationObjectsModule).not.toHaveProperty("createSoraCanonicalizationGrant");
    expect(integrationObjectsModule).not.toHaveProperty("SoraGrantIssuerContext");
    expect(integrationObjectsModule).not.toHaveProperty("CreateSoraCanonicalizationGrantParams");
    expect(integrationObjectsModule).not.toHaveProperty("mintSoraCanonicalizationGrantId");
  });

  it("fabricated-context attack is NOT REPRESENTABLE: no issuance function exists to call", () => {
    // The exact A.8 attack shape: valid ACCEPTED/CLASSIFIED integration +
    // valid live edge; attacker reads integration row + edge row; attacker
    // knows the exact grantor session and transaction; attacker attempts every
    // public/general issuance path available to an arbitrary internal caller.
    let authorityId = "";
    withEnv(env, () => {
      const edge = createSoraDelegationEdge(
        {
          delegationId: "P0_C1_DELEGATION_TEST",
          grantorSessionKey: PARENT_SESSION,
          granteeSessionKey: C1_SESSION,
          grantorTransactionRunId: PARENT_TX,
          granteeTransactionRunId: C1_TX,
          edgeKind: "P0_C1",
          authority: makeAuthority({
            depth: SORA_P0_C1_MAX_DEPTH,
            maxDescendants: 1,
            delegableCeiling: true,
          }),
          rootDelegationId: ROOT_DELEGATION_ID,
        },
        { env },
      );
      expect(edge.ok).toBe(true);
      authorityId = edge.ok ? edge.authorityId : "";
      const created = createSoraIntegrationObject(
        {
          integrationId: "INTEGRATION_REPLAY",
          delegationId: "P0_C1_DELEGATION_TEST",
          authorityId,
          kind: "P0_C1",
          childResultSessionKey: C1_SESSION,
          childResultRunId: C1_TX,
          originatingTransactionRunId: C1_TX,
          parentSessionKey: PARENT_SESSION,
          parentTransactionRunId: PARENT_TX,
          resultDigest: DIGEST,
          provenanceJson: "{}",
          now: 100,
        },
        { env },
      );
      expect(created.ok).toBe(true);
      const classified = classifySoraIntegration(
        {
          integrationId: "INTEGRATION_REPLAY",
          classification: "ACCEPTED",
          parentResultChanged: true,
          now: 200,
        },
        { env },
      );
      expect(classified.ok).toBe(true);
    });
    // Attacker reads the exact grantor values from the edge row.
    let edgeValues: Record<string, string> = {};
    withEnv(env, () => {
      const row = openOpenClawStateDatabase({ env })
        .db.prepare(
          `SELECT delegation_id, authority_id, grantor_session_key, grantor_transaction_run_id
             FROM sora_delegation_edges WHERE delegation_id = 'P0_C1_DELEGATION_TEST'`,
        )
        .get() as Record<string, string>;
      edgeValues = { ...row };
    });
    expect(edgeValues.grantor_session_key).toBe(PARENT_SESSION);
    expect(edgeValues.grantor_transaction_run_id).toBe(PARENT_TX);
    // There is NO issuance function in the module: the attacker cannot call
    // any public path with the exact copied values. The only way to create a
    // grant row would be a raw DB write, which sits inside the trusted
    // computing base (DB_WRITE_IS_TCB_ACCEPTABLE) and is not a supported
    // internal API.
    const issuanceCallables = [
      integrationObjectsModule.createSoraCanonicalizationGrant,
      integrationObjectsModule.mintSoraCanonicalizationGrantId,
    ].filter((fn) => typeof fn === "function");
    expect(issuanceCallables).toEqual([]);
  });

  it("knowledge of every durable identifier is insufficient for issuance (no issuance API)", () => {
    // KNOWLEDGE(SESSION_ID, TRANSACTION_ID, EDGE_ID, AUTHORITY_ID) !=
    // POSSESSION_OF_ISSUANCE_AUTHORITY: possessing every identifier string
    // cannot produce a grant because no callable issuance surface exists.
    const identifiers = {
      sessionId: PARENT_SESSION,
      transactionId: PARENT_TX,
      edgeId: "P0_C1_DELEGATION_TEST",
      authorityId: "AUTH_P0_C1_DELEGATION_TEST",
      digest: DIGEST,
    };
    expect(identifiers.sessionId).toBeTruthy();
    expect(identifiers.transactionId).toBeTruthy();
    // And the module still exposes no path that accepts them for issuance.
    expect(integrationObjectsModule).not.toHaveProperty("issueSoraCanonicalizationGrant");
    expect(integrationObjectsModule).not.toHaveProperty("createSoraCanonicalizationGrantIssuer");
  });
});

describe("markSoraIntegrationCanonicalized", () => {
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

  /** Full valid parent-side authority: live edge + CLASSIFIED integration + TCB-seeded grant. */
  function seedValidAuthority(
    overrides: {
      integrationId?: string;
      delegationId?: string;
      parentSession?: string;
      parentTx?: string;
      resultDigest?: string;
      kind?: "P0_C1" | "C1_G1";
      edgeKind?: "P0_C1" | "C1_G1";
      grantorSession?: string;
      grantorTx?: string;
    } = {},
  ): Seeded {
    const integrationId = overrides.integrationId ?? "INTEGRATION_P0_TEST";
    const delegationId = overrides.delegationId ?? "P0_C1_DELEGATION_TEST";
    const kind = overrides.kind ?? "P0_C1";
    const edgeKind = overrides.edgeKind ?? kind;
    const parentSession = overrides.parentSession ?? PARENT_SESSION;
    const parentTx = overrides.parentTx ?? PARENT_TX;
    const resultDigest = overrides.resultDigest ?? DIGEST;
    const grantId = `CANONICALIZE_GRANT_${delegationId}`;
    let authorityId = "";
    withEnv(env, () => {
      const edge = createSoraDelegationEdge(
        {
          delegationId,
          grantorSessionKey: overrides.grantorSession ?? parentSession,
          granteeSessionKey: C1_SESSION,
          grantorTransactionRunId: overrides.grantorTx ?? parentTx,
          granteeTransactionRunId: C1_TX,
          edgeKind,
          authority: makeAuthority({
            depth: edgeKind === "P0_C1" ? SORA_P0_C1_MAX_DEPTH : SORA_C1_G1_MAX_DEPTH_FROM_P0,
            maxDescendants: edgeKind === "P0_C1" ? 1 : 0,
            delegableCeiling: edgeKind === "P0_C1",
          }),
          rootDelegationId: ROOT_DELEGATION_ID,
        },
        { env },
      );
      expect(edge.ok).toBe(true);
      authorityId = edge.ok ? edge.authorityId : "";
      const created = createSoraIntegrationObject(
        {
          integrationId,
          delegationId,
          authorityId,
          kind,
          childResultSessionKey: C1_SESSION,
          childResultRunId: C1_TX,
          originatingTransactionRunId: C1_TX,
          parentSessionKey: parentSession,
          parentTransactionRunId: parentTx,
          resultDigest,
          provenanceJson: "{}",
          now: 100,
        },
        { env },
      );
      expect(created.ok).toBe(true);
      const classified = classifySoraIntegration(
        { integrationId, classification: "ACCEPTED", parentResultChanged: true, now: 200 },
        { env },
      );
      expect(classified.ok).toBe(true);
      seedGrantRow(env, {
        grantId,
        integrationId,
        delegationId,
        authorityId,
        parentSessionKey: parentSession,
        parentTransactionRunId: parentTx,
        resultDigest,
      });
    });
    return {
      env,
      integrationId,
      delegationId,
      authorityId,
      grantId,
      binding: {
        grantId,
        parentSessionKey: parentSession,
        parentTransactionRunId: parentTx,
        delegationId,
        authorityId,
        resultDigest,
      },
    };
  }

  function attemptCanonicalize(seeded: Seeded, binding?: SoraCanonicalizationAuthorityBinding) {
    let result: { ok: true } | { ok: false; reason: string };
    withEnv(env, () => {
      result = markSoraIntegrationCanonicalized(
        { integrationId: seeded.integrationId, authority: binding ?? seeded.binding, now: 300 },
        { env },
      );
    });
    return result!;
  }

  it("valid live governed parent-side authority -> PASS", () => {
    const seeded = seedValidAuthority();
    const result = attemptCanonicalize(seeded);
    expect(result.ok).toBe(true);
    withEnv(env, () => {
      const row = openOpenClawStateDatabase({ env })
        .db.prepare(
          "SELECT canonicalized, integration_status FROM sora_integration_objects WHERE integration_id = ?",
        )
        .get(seeded.integrationId) as { canonicalized: number; integration_status: string };
      expect(row.canonicalized).toBe(1);
      expect(row.integration_status).toBe("INTEGRATED");
    });
  });

  it("no delegation edge -> FAIL", () => {
    const seeded = seedValidAuthority();
    withEnv(env, () => {
      openOpenClawStateDatabase({ env })
        .db.prepare("DELETE FROM sora_delegation_edges WHERE delegation_id = ?")
        .run(seeded.delegationId);
    });
    const result = attemptCanonicalize(seeded);
    expect(result.ok).toBe(false);
  });

  it("wrong delegation edge -> FAIL", () => {
    const seeded = seedValidAuthority();
    const result = attemptCanonicalize(seeded, {
      ...seeded.binding,
      delegationId: "WRONG_DELEGATION",
    });
    expect(result.ok).toBe(false);
  });

  it("wrong authority ID -> FAIL", () => {
    const seeded = seedValidAuthority();
    const result = attemptCanonicalize(seeded, {
      ...seeded.binding,
      authorityId: "WRONG_AUTHORITY",
    });
    expect(result.ok).toBe(false);
  });

  it("revoked edge -> FAIL", () => {
    const seeded = seedValidAuthority();
    withEnv(env, () => {
      openOpenClawStateDatabase({ env })
        .db.prepare(
          "UPDATE sora_delegation_edges SET revocation_reason = ? WHERE delegation_id = ?",
        )
        .run("revoked", seeded.delegationId);
    });
    const result = attemptCanonicalize(seeded);
    expect(result.ok).toBe(false);
  });

  it("wrong parent session -> FAIL", () => {
    const seeded = seedValidAuthority();
    const result = attemptCanonicalize(seeded, {
      ...seeded.binding,
      parentSessionKey: "agent:attacker:attacker",
    });
    expect(result.ok).toBe(false);
  });

  it("wrong parent transaction -> FAIL", () => {
    const seeded = seedValidAuthority();
    const result = attemptCanonicalize(seeded, {
      ...seeded.binding,
      parentTransactionRunId: "wrong-transaction",
    });
    expect(result.ok).toBe(false);
  });

  it("wrong result digest -> FAIL", () => {
    const seeded = seedValidAuthority();
    const result = attemptCanonicalize(seeded, {
      ...seeded.binding,
      resultDigest: "digest-tampered",
    });
    expect(result.ok).toBe(false);
  });

  it("PENDING integration -> FAIL", () => {
    const seeded = seedValidAuthority();
    withEnv(env, () => {
      openOpenClawStateDatabase({ env })
        .db.prepare(
          `UPDATE sora_integration_objects
             SET classification = 'PENDING', integration_status = 'TRANSPORT_RECEIVED'
             WHERE integration_id = ?`,
        )
        .run(seeded.integrationId);
    });
    const result = attemptCanonicalize(seeded);
    expect(result.ok).toBe(false);
  });

  it("REJECTED integration -> FAIL", () => {
    const seeded = seedValidAuthority();
    withEnv(env, () => {
      openOpenClawStateDatabase({ env })
        .db.prepare(
          `UPDATE sora_integration_objects
             SET classification = 'REJECTED', integration_status = 'REJECTED'
             WHERE integration_id = ?`,
        )
        .run(seeded.integrationId);
    });
    const result = attemptCanonicalize(seeded);
    expect(result.ok).toBe(false);
  });

  it("already canonicalized -> FAIL", () => {
    const seeded = seedValidAuthority();
    const first = attemptCanonicalize(seeded);
    expect(first.ok).toBe(true);
    const second = attemptCanonicalize(seeded);
    expect(second.ok).toBe(false);
  });

  it("integration-row replay with zero authority records -> FAIL", () => {
    // Genuine replay: seed a valid CLASSIFIED integration row, then read every
    // stored binding field exactly as an attacker with shared-state read access
    // could, and replay it with no edge and no grant ever created.
    withEnv(env, () => {
      const created = createSoraIntegrationObject(
        {
          integrationId: "INTEGRATION_REPLAY",
          delegationId: "P0_C1_DELEGATION_REPLAY",
          authorityId: "AUTH_P0_C1_DELEGATION_REPLAY",
          kind: "P0_C1",
          childResultSessionKey: C1_SESSION,
          childResultRunId: C1_TX,
          originatingTransactionRunId: C1_TX,
          parentSessionKey: PARENT_SESSION,
          parentTransactionRunId: PARENT_TX,
          resultDigest: DIGEST,
          provenanceJson: "{}",
          now: 100,
        },
        { env },
      );
      expect(created.ok).toBe(true);
      const classified = classifySoraIntegration(
        {
          integrationId: "INTEGRATION_REPLAY",
          classification: "ACCEPTED",
          parentResultChanged: true,
          now: 200,
        },
        { env },
      );
      expect(classified.ok).toBe(true);
    });
    let replay: Record<string, string> = {};
    withEnv(env, () => {
      const row = openOpenClawStateDatabase({ env })
        .db.prepare(
          `SELECT delegation_id, authority_id, parent_session_key, parent_transaction_run_id, result_digest
             FROM sora_integration_objects WHERE integration_id = 'INTEGRATION_REPLAY'`,
        )
        .get() as Record<string, string>;
      replay = { ...row };
    });
    const result = attemptCanonicalize({
      env,
      integrationId: "INTEGRATION_REPLAY",
      delegationId: replay.delegation_id,
      authorityId: replay.authority_id,
      grantId: "CANONICALIZE_GRANT_attacker-chosen",
      binding: {
        grantId: "CANONICALIZE_GRANT_attacker-chosen",
        parentSessionKey: replay.parent_session_key,
        parentTransactionRunId: replay.parent_transaction_run_id,
        delegationId: replay.delegation_id,
        authorityId: replay.authority_id,
        resultDigest: replay.result_digest,
      },
    });
    // Zero delegation edges and zero grants exist: replay must fail closed.
    expect(result.ok).toBe(false);
  });

  it("stale/revoked formerly-valid authority replay -> FAIL", () => {
    const seeded = seedValidAuthority();
    // Prove the invocation would pass while the authority is live.
    const before = attemptCanonicalize(seeded);
    expect(before.ok).toBe(true);
    // A formerly-valid grant replayed after its edge was revoked must fail.
    withEnv(env, () => {
      openOpenClawStateDatabase({ env })
        .db.prepare(
          "UPDATE sora_delegation_edges SET revocation_reason = ? WHERE delegation_id = ?",
        )
        .run("revoked", seeded.delegationId);
    });
    const after = attemptCanonicalize(seeded);
    expect(after.ok).toBe(false);
  });

  it("G1/child-side authority attempting canonicalization -> FAIL", () => {
    const seeded = seedValidAuthority();
    const result = attemptCanonicalize(seeded, {
      ...seeded.binding,
      parentSessionKey: "agent:g1:g1",
    });
    expect(result.ok).toBe(false);
  });

  it("valid use once -> PASS, second use of the same grant -> FAIL", () => {
    const seeded = seedValidAuthority();
    const first = attemptCanonicalize(seeded);
    expect(first.ok).toBe(true);
    const second = attemptCanonicalize(seeded);
    expect(second.ok).toBe(false);
  });

  it("grant bound to another integration -> FAIL", () => {
    const seeded = seedValidAuthority();
    const other = seedValidAuthority({
      integrationId: "INTEGRATION_P0_TEST_2",
      delegationId: "P0_C1_DELEGATION_TEST_2",
    });
    // Replay the first grant against the second integration: the grant is
    // exact-integration bound and must fail.
    const result = attemptCanonicalize(other, {
      ...other.binding,
      grantId: seeded.grantId,
    });
    expect(result.ok).toBe(false);
  });

  it("canonicalization grant must exist; grant-id alone without grant row -> FAIL", () => {
    const seeded = seedValidAuthority();
    withEnv(env, () => {
      openOpenClawStateDatabase({ env })
        .db.prepare("DELETE FROM sora_canonicalization_grants WHERE grant_id = ?")
        .run(seeded.grantId);
    });
    const result = attemptCanonicalize(seeded);
    expect(result.ok).toBe(false);
  });

  it("revoked canonicalization grant -> FAIL", () => {
    const seeded = seedValidAuthority();
    const revocation = revokeSoraDelegationEdgeAndGrants({
      edgeDelegationId: seeded.delegationId,
      revocationReason: "revoked",
      now: 300,
      options: { env },
    });
    expect(revocation.ok).toBe(true);
    const result = attemptCanonicalize(seeded);
    expect(result.ok).toBe(false);
  });

  it("wrong semantic role: C1_G1 grant cannot canonicalize a P0_C1 integration", () => {
    // The grant is edge-derived; a C1_G1-edge-derived grant is bound to the
    // C1_G1 delegation and never satisfies the P0_C1 integration. Proven by
    // direct row surgery: a grant row whose edge kind does not match the
    // integration kind fails.
    const seeded = seedValidAuthority();
    withEnv(env, () => {
      const c1Edge = createSoraDelegationEdge(
        {
          delegationId: "C1_G1_DELEGATION_ROLE",
          grantorSessionKey: C1_SESSION,
          granteeSessionKey: "agent:g1:g1",
          grantorTransactionRunId: C1_TX,
          granteeTransactionRunId: "G1-transaction-1",
          edgeKind: "C1_G1",
          authority: makeAuthority({
            depth: SORA_C1_G1_MAX_DEPTH_FROM_P0,
            maxDescendants: 0,
            delegableCeiling: false,
          }),
          rootDelegationId: ROOT_DELEGATION_ID,
        },
        { env },
      );
      expect(c1Edge.ok).toBe(true);
      openOpenClawStateDatabase({ env })
        .db.prepare("UPDATE sora_canonicalization_grants SET delegation_id = ? WHERE grant_id = ?")
        .run("C1_G1_DELEGATION_ROLE", seeded.grantId);
    });
    const result = attemptCanonicalize(seeded);
    expect(result.ok).toBe(false);
  });

  it("revocation flow: passing state, revoke the authority edge, same shape now fails", () => {
    const seeded = seedValidAuthority();
    const before = attemptCanonicalize(seeded);
    expect(before.ok).toBe(true);
    const second = seedValidAuthority({
      integrationId: "INTEGRATION_P0_TEST_2",
      delegationId: "P0_C1_DELEGATION_TEST_2",
    });
    const revocation = revokeSoraDelegationEdgeAndGrants({
      edgeDelegationId: second.delegationId,
      revocationReason: "revoked",
      now: 300,
      options: { env },
    });
    expect(revocation.ok).toBe(true);
    const after = attemptCanonicalize(second);
    expect(after.ok).toBe(false);
  });

  it("C1_G1 integration canonicalized by its parent C1 (parent-side role) -> PASS", () => {
    const seeded = seedValidAuthority({
      integrationId: "INTEGRATION_C1G1_TEST",
      delegationId: "C1_G1_DELEGATION_TEST",
      kind: "C1_G1",
      edgeKind: "C1_G1",
      parentSession: C1_SESSION,
      parentTx: C1_TX,
      grantorSession: C1_SESSION,
      grantorTx: C1_TX,
    });
    const result = attemptCanonicalize(seeded);
    expect(result.ok).toBe(true);
  });

  it("successful canonicalization atomically consumes the exact grant", () => {
    const seeded = seedValidAuthority();
    const result = attemptCanonicalize(seeded);
    expect(result.ok).toBe(true);
    withEnv(env, () => {
      const row = openOpenClawStateDatabase({ env })
        .db.prepare("SELECT used, revoked FROM sora_canonicalization_grants WHERE grant_id = ?")
        .get(seeded.grantId) as { used: number; revoked: number };
      expect(row.used).toBe(1);
      expect(row.revoked).toBe(0);
    });
  });
});

describe("governed edge revocation seam", () => {
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

  it("revoking an edge cascades to its unused grants in one transaction", () => {
    let delegationId = "";
    let grantId = "";
    withEnv(env, () => {
      const edge = createSoraDelegationEdge(
        {
          delegationId: "P0_C1_DELEGATION_TEST",
          grantorSessionKey: PARENT_SESSION,
          granteeSessionKey: C1_SESSION,
          grantorTransactionRunId: PARENT_TX,
          granteeTransactionRunId: C1_TX,
          edgeKind: "P0_C1",
          authority: makeAuthority({
            depth: SORA_P0_C1_MAX_DEPTH,
            maxDescendants: 1,
            delegableCeiling: true,
          }),
          rootDelegationId: ROOT_DELEGATION_ID,
        },
        { env },
      );
      expect(edge.ok).toBe(true);
      delegationId = "P0_C1_DELEGATION_TEST";
      const created = createSoraIntegrationObject(
        {
          integrationId: "INTEGRATION_P0_TEST",
          delegationId,
          authorityId: edge.ok ? edge.authorityId : "",
          kind: "P0_C1",
          childResultSessionKey: C1_SESSION,
          childResultRunId: C1_TX,
          originatingTransactionRunId: C1_TX,
          parentSessionKey: PARENT_SESSION,
          parentTransactionRunId: PARENT_TX,
          resultDigest: DIGEST,
          provenanceJson: "{}",
          now: 100,
        },
        { env },
      );
      expect(created.ok).toBe(true);
      const classified = classifySoraIntegration(
        {
          integrationId: "INTEGRATION_P0_TEST",
          classification: "ACCEPTED",
          parentResultChanged: true,
          now: 200,
        },
        { env },
      );
      expect(classified.ok).toBe(true);
      grantId = `CANONICALIZE_GRANT_${delegationId}`;
      seedGrantRow(env, {
        grantId,
        integrationId: "INTEGRATION_P0_TEST",
        delegationId,
        authorityId: edge.ok ? edge.authorityId : "",
        parentSessionKey: PARENT_SESSION,
        parentTransactionRunId: PARENT_TX,
        resultDigest: DIGEST,
      });
    });
    const revocation = revokeSoraDelegationEdgeAndGrants({
      edgeDelegationId: delegationId,
      revocationReason: "revoked",
      now: 300,
      options: { env },
    });
    expect(revocation.ok).toBe(true);
    if (revocation.ok) {
      expect(revocation.edgeRevoked).toBe(1);
      expect(revocation.grantsRevoked).toBe(1);
    }
    withEnv(env, () => {
      const edgeRow = openOpenClawStateDatabase({ env })
        .db.prepare("SELECT revocation_reason FROM sora_delegation_edges WHERE delegation_id = ?")
        .get(delegationId) as { revocation_reason: string | null };
      expect(edgeRow.revocation_reason).toBe("revoked");
      const grantRow = openOpenClawStateDatabase({ env })
        .db.prepare("SELECT revoked FROM sora_canonicalization_grants WHERE grant_id = ?")
        .get(grantId) as { revoked: number };
      expect(grantRow.revoked).toBe(1);
    });
  });

  it("edge revocation is idempotent; second revocation revokes nothing new", () => {
    let delegationId = "";
    withEnv(env, () => {
      const edge = createSoraDelegationEdge(
        {
          delegationId: "P0_C1_DELEGATION_TEST",
          grantorSessionKey: PARENT_SESSION,
          granteeSessionKey: C1_SESSION,
          grantorTransactionRunId: PARENT_TX,
          granteeTransactionRunId: C1_TX,
          edgeKind: "P0_C1",
          authority: makeAuthority({
            depth: SORA_P0_C1_MAX_DEPTH,
            maxDescendants: 1,
            delegableCeiling: true,
          }),
          rootDelegationId: ROOT_DELEGATION_ID,
        },
        { env },
      );
      expect(edge.ok).toBe(true);
      delegationId = "P0_C1_DELEGATION_TEST";
    });
    const first = revokeSoraDelegationEdgeAndGrants({
      edgeDelegationId: delegationId,
      revocationReason: "revoked",
      now: 300,
      options: { env },
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.edgeRevoked).toBe(1);
    }
    const second = revokeSoraDelegationEdgeAndGrants({
      edgeDelegationId: delegationId,
      revocationReason: "revoked-again",
      now: 400,
      options: { env },
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.edgeRevoked).toBe(0);
    }
  });

  it("revoking a missing edge -> FAIL", () => {
    const result = revokeSoraDelegationEdgeAndGrants({
      edgeDelegationId: "MISSING_EDGE",
      revocationReason: "revoked",
      now: 300,
      options: { env },
    });
    expect(result.ok).toBe(false);
  });
});
