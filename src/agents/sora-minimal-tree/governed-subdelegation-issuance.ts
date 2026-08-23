/**
 * Governed subdelegation issuance (Phase B1).
 *
 * Exposes exactly ONE production-authoritative issuance seam:
 *
 *   `issueGovernedSubdelegationGrant(...)`
 *
 * Requirements enforced here:
 *
 * - BOTH `VALID_ACTIVE_GOVERNED_STATE` AND `LIVE_RUNTIME_POSSESSION` are
 *   required: the transaction must be ACTIVE with matching lifecycle
 *   generation, and the handle must be the exact live process-local object
 *   (private object identity; `IDENTIFIER_KNOWLEDGE != POSSESSION`).
 * - The function never accepts a serialized replacement for
 *   `ActiveGovernedParentHandle`.
 * - The entire issuance is ONE fail-closed atomic transaction (BEGIN
 *   IMMEDIATE; any failure ROLLBACKs) covering: live handle possession →
 *   governed parent ACTIVE → lifecycle epoch/generation → authoritative
 *   caller binding → parent authority → delegation edge state → requested G1
 *   authority → Phase-A non-amplification → issuance CAS → child transaction
 *   creation → governed grant → holder/provenance → Phase-B→Phase-A handoff
 *   state (capability for the Phase-A consume gate) → affected-row
 *   verification → COMMIT.
 * - ANY failure → ROLLBACK → NO_VALID_GRANT → NO_READINESS → NO_G1_ELIGIBILITY.
 * - There is NO other exported production grant writer in this module.
 */
import { randomUUID } from "node:crypto";
import type { OpenClawStateDatabaseOptions } from "../../state/openclaw-state-db.js";
import { runOpenClawStateWriteTransaction } from "../../state/openclaw-state-db.js";
import { stableStringify } from "../stable-stringify.js";
import { createSoraDelegationEdge, resolveG1DelegationAuthority } from "./delegation-edge.js";
import { isActiveGovernedParentHandle } from "./governed-parent-context.js";
import type { ActiveGovernedParentHandle } from "./governed-parent-context.js";
import { resolvePossessedGovernedParentForRun } from "./governed-runtime-attachment.js";
import type { GovernedTransaction } from "./governed-transaction-controller.js";
import { createGovernedTransaction } from "./governed-transaction-controller.js";
import {
  createSoraC1G1CapabilityRecord,
  insertSoraC1G1Capability,
} from "./one-shot-subdelegation.js";
import { compareSoraAuthority, edgeRowToRecord, type SoraDelegationAuthority } from "./store.js";
import { ensureSoraMinimalTreeSchema } from "./store.js";

export type GovernedSubdelegationGrant = {
  /**
   * The exact requested G1 authority. When omitted, the seam derives the
   * canonical Phase-A G1 authority from the live parent ceiling inside the
   * transaction (the production internal path never supplies a request).
   */
  requestedG1Authority?: SoraDelegationAuthority;
  granteeSessionKey: string;
  holderSessionKey: string;
  now?: number;
  options?: OpenClawStateDatabaseOptions;
};

export type GovernedIssuanceResult =
  | {
      ok: true;
      grantId: string;
      delegationId: string;
      authorityId: string;
      capabilityId: string;
      transactionRunId: string;
      readinessRecorded: true;
    }
  | { ok: false; reason: string; detail?: string };

const REASON_HANDLE_NOT_LIVE = "handle-not-live-possession";
const REASON_TXN_NOT_ACTIVE = "no-active-governed-transaction";
const REASON_GENERATION_MISMATCH = "governed-lifecycle-generation-mismatch";
const REASON_CALLER_EMPTY = "authoritative-caller-binding-empty";
const REASON_PARENT_EDGE_MISSING = "parent-delegation-edge-missing";
const REASON_NOT_DELEGABLE = "parent-edge-not-delegable-ceiling";
const REASON_AMPLIFICATION = "authority-amplification-forbidden";
const REASON_BOUNDS = "grant-bounds-violation";
const REASON_ISSUANCE_SCOPE_ALREADY_ISSUED = "issuance-scope-already-issued";
const REASON_CAS = "issuance-cas-failed";
const REASON_AFFECTED_ROWS = "affected-row-verification-failed";
const REASON_UNEXPECTED = "issuance-failed";

const ISSUANCE_ERROR_REASONS = new Set<string>([
  REASON_PARENT_EDGE_MISSING,
  REASON_NOT_DELEGABLE,
  REASON_AMPLIFICATION,
  REASON_BOUNDS,
  REASON_CAS,
  REASON_ISSUANCE_SCOPE_ALREADY_ISSUED,
  REASON_AFFECTED_ROWS,
]);

function issuanceFailure(reason: string, detail?: string): GovernedIssuanceResult {
  return { ok: false, reason, ...(detail ? { detail } : {}) };
}

/**
 * The one production-authoritative issuance seam. Requires BOTH a live
 * process-local handle (LIVE_RUNTIME_POSSESSION) and an ACTIVE governed
 * transaction (VALID_ACTIVE_GOVERNED_STATE). Serialized/reconstructed
 * handles fail closed at the object-identity check.
 */
export function issueGovernedSubdelegationGrant(params: {
  handle: ActiveGovernedParentHandle;
  transaction: GovernedTransaction;
  grant: GovernedSubdelegationGrant;
}): GovernedIssuanceResult {
  if (!isActiveGovernedParentHandle(params.handle)) {
    return issuanceFailure(REASON_HANDLE_NOT_LIVE);
  }
  const transaction = params.transaction;
  if (transaction.handle !== params.handle) {
    return issuanceFailure(REASON_HANDLE_NOT_LIVE, "transaction is not bound to this handle");
  }
  if (transaction.state() !== "ACTIVE") {
    return issuanceFailure(REASON_TXN_NOT_ACTIVE);
  }
  if (transaction.lifecycleGeneration !== params.handle.lifecycleGeneration) {
    return issuanceFailure(REASON_GENERATION_MISMATCH);
  }
  const callerSessionKey = transaction.authoritativeCallerSessionKey;
  const callerRunId = transaction.authoritativeCallerRunId;
  if (!callerSessionKey || !callerRunId) {
    return issuanceFailure(REASON_CALLER_EMPTY);
  }

  const now = params.grant.now ?? Date.now();
  const options = params.grant.options ?? {};
  const granteeSessionKey = params.grant.granteeSessionKey.trim();
  const holderSessionKey = params.grant.holderSessionKey.trim();
  if (!granteeSessionKey || !holderSessionKey) {
    return issuanceFailure(REASON_CALLER_EMPTY, "grantee/holder session keys are required");
  }

  let result: GovernedIssuanceResult = issuanceFailure(REASON_UNEXPECTED);
  try {
    ensureSoraMinimalTreeSchema(options);
    runOpenClawStateWriteTransaction(
      ({ db }) => {
        // Parent authority: re-read under the same BEGIN IMMEDIATE lock (TOCTOU-safe).
        const parentRow = db
          .prepare(
            `SELECT * FROM sora_delegation_edges
             WHERE edge_kind = 'P0_C1'
               AND grantee_session_key = ?
               AND (revocation_reason IS NULL OR revocation_reason = '')
             ORDER BY created_at DESC LIMIT 1`,
          )
          .get(callerSessionKey) as Record<string, unknown> | undefined;
        const parentEdge = parentRow ? edgeRowToRecord(parentRow as never) : undefined;
        if (!parentEdge) {
          throw new Error(REASON_PARENT_EDGE_MISSING);
        }
        if (parentEdge.edgeKind !== "P0_C1" || !parentEdge.authority.delegableCeiling) {
          throw new Error(REASON_NOT_DELEGABLE);
        }
        // Canonical Phase-A G1 derivation from the actual ceiling. This is
        // the authoritative G1 authority: a locally reconstructed request
        // object that merely duplicates the derivation is not accepted.
        const derived = resolveG1DelegationAuthority({
          granteeSessionKey,
          grantorTransactionRunId: callerRunId,
          ceiling: parentEdge.authority,
        });
        if (!derived.ok) {
          throw new Error(REASON_AMPLIFICATION);
        }
        const g1Authority = derived.authority;
        if (params.grant.requestedG1Authority !== undefined) {
          // Explicit-request path (tests): the request must pass canonical
          // non-amplification against the ceiling AND equal the canonical
          // derivation output; anything else fails closed.
          const comparison = compareSoraAuthority(
            parentEdge.authority,
            params.grant.requestedG1Authority,
          );
          if (!comparison.ok) {
            throw new Error(REASON_AMPLIFICATION);
          }
          if (stableStringify(params.grant.requestedG1Authority) !== stableStringify(g1Authority)) {
            throw new Error(REASON_AMPLIFICATION);
          }
        }
        if (
          g1Authority.depth !== 2 ||
          g1Authority.maxDescendants !== 0 ||
          g1Authority.delegableCeiling ||
          g1Authority.delegated === true
        ) {
          throw new Error(REASON_BOUNDS);
        }
        // C1→G1 delegation edge via Phase-A reuse (same shared connection).
        const delegationId = `C1G1_${randomUUID()}`;
        const edgeResult = createSoraDelegationEdge(
          {
            delegationId,
            grantorSessionKey: callerSessionKey,
            granteeSessionKey,
            grantorTransactionRunId: callerRunId,
            edgeKind: "C1_G1",
            authority: g1Authority,
            parentDelegationId: parentEdge.delegationId,
            rootDelegationId: parentEdge.rootDelegationId,
          },
          options,
        );
        if (!edgeResult.ok) {
          throw new Error(REASON_CAS);
        }
        // One-shot capability via Phase-A (handoff state for the consume gate).
        const capabilityId = `CAP_${randomUUID()}`;
        const capabilityRecord = createSoraC1G1CapabilityRecord({
          capabilityId,
          delegationId,
          authorityId: edgeResult.authorityId,
          issueDelegationId: parentEdge.delegationId,
          issueAuthorityId: parentEdge.authorityId,
          grantorSessionKey: callerSessionKey,
          granteeSessionKey,
          transactionRunId: callerRunId,
          now,
        });
        const capabilityInsert = insertSoraC1G1Capability(capabilityRecord, options);
        if (!capabilityInsert.ok) {
          throw new Error(REASON_CAS);
        }
        // Governed grant row with holder + provenance.
        const grantId = `GRANT_${randomUUID()}`;
        const parentTransactionId = `TXN_${randomUUID()}`;
        const provenance = stableStringify([
          grantId,
          parentTransactionId,
          callerRunId,
          parentEdge.delegationId,
          parentEdge.authorityId,
          callerSessionKey,
          granteeSessionKey,
          holderSessionKey,
          params.handle.lifecycleGeneration,
        ]);
        // Parent governed transaction row (B→A handoff state).
        const parentTxnInsert = db
          .prepare(
            `INSERT INTO governed_transaction_runs (
              transaction_id, parent_transaction_id, kind, status,
              lifecycle_generation, authoritative_session_key, authoritative_run_id,
              grant_id, created_at, updated_at
            ) VALUES (?, NULL, 'PARENT', 'COMPLETED', ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            parentTransactionId,
            params.handle.lifecycleGeneration,
            callerSessionKey,
            callerRunId,
            grantId,
            now,
            now,
          );
        if (parentTxnInsert.changes !== 1) {
          throw new Error(REASON_AFFECTED_ROWS);
        }
        // Authoritative caller binding row (derived from the handle only).
        // The handle_claim is an inert audit marker, deliberately NOT the
        // handle id and NOT a token: ROW_MATCH != POSSESSION, so no row value
        // can ever reconstruct or validate the process-local handle.
        const bindingInsert = db
          .prepare(
            `INSERT INTO authoritative_caller_bindings (
              binding_id, transaction_id, session_key, run_id,
              lifecycle_generation, handle_claim, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `BINDING_${randomUUID()}`,
            parentTransactionId,
            callerSessionKey,
            callerRunId,
            params.handle.lifecycleGeneration,
            "RUNTIME_POSSESSION_OBJECT",
            now,
            now,
          );
        if (bindingInsert.changes !== 1) {
          throw new Error(REASON_AFFECTED_ROWS);
        }
        const grantInsert = db
          .prepare(
            `INSERT INTO governed_subdelegation_grants (
              grant_id, delegation_id, authority_id, capability_id,
              parent_transaction_run_id, grantor_session_key, grantee_session_key,
              holder_session_key, parent_edge_delegation_id, lifecycle_generation,
              status, max_uses, max_descendants, max_depth_from_p0,
              retry_allowed, fallback_allowed, further_delegation_allowed,
              provenance_json, issued_at, updated_at
            ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, 1, 2, 0, 0, 0, ?, ?, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM governed_subdelegation_grants
              WHERE parent_transaction_run_id = ?
                AND grantor_session_key = ?
                AND grantee_session_key = ?
                AND status = 'ACTIVE'
            )`,
          )
          .run(
            grantId,
            delegationId,
            edgeResult.authorityId,
            capabilityId,
            callerRunId,
            callerSessionKey,
            granteeSessionKey,
            holderSessionKey,
            parentEdge.delegationId,
            params.handle.lifecycleGeneration,
            provenance,
            now,
            now,
            callerRunId,
            callerSessionKey,
            granteeSessionKey,
          );
        if (grantInsert.changes !== 1) {
          // The guarded single-winner insert and the partial UNIQUE index
          // (parent run + grantor + grantee WHERE status = 'ACTIVE') together
          // enforce AT_MOST_ONE_VALID_CHILD_ISSUANCE. A second equivalent
          // issuance (sequential or concurrent) loses here, inside the same
          // BEGIN IMMEDIATE transaction, so NO second grant/readiness/edge/
          // capability ever materializes.
          throw new Error(REASON_ISSUANCE_SCOPE_ALREADY_ISSUED);
        }
        // Child governed transaction creation (B→A handoff state).
        const childInsert = db
          .prepare(
            `INSERT INTO governed_transaction_runs (
              transaction_id, parent_transaction_id, kind, status,
              lifecycle_generation, authoritative_session_key, authoritative_run_id,
              grant_id, created_at, updated_at
            ) VALUES (?, ?, 'CHILD', 'ACTIVE', ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `TXN_CHILD_${randomUUID()}`,
            parentTransactionId,
            params.handle.lifecycleGeneration,
            callerSessionKey,
            callerRunId,
            grantId,
            now,
            now,
          );
        if (childInsert.changes !== 1) {
          throw new Error(REASON_AFFECTED_ROWS);
        }
        // Readiness — derivative evidence only (READINESS != AUTHORITY).
        const readinessId = `READINESS_${randomUUID()}`;
        const readinessInsert = db
          .prepare(
            `INSERT INTO sora_edge_readiness (
              readiness_id, grant_id, delegation_id, authority_id,
              lifecycle_generation, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'READY', ?, ?)`,
          )
          .run(
            readinessId,
            grantId,
            delegationId,
            edgeResult.authorityId,
            params.handle.lifecycleGeneration,
            now,
            now,
          );
        if (readinessInsert.changes !== 1) {
          throw new Error(REASON_AFFECTED_ROWS);
        }
        // Affected-row verification inside the same transaction.
        const grantVerify = db
          .prepare("SELECT grant_id FROM governed_subdelegation_grants WHERE grant_id = ?")
          .get(grantId) as { grant_id: string } | undefined;
        const capabilityVerify = db
          .prepare("SELECT capability_id FROM sora_c1_g1_capabilities WHERE capability_id = ?")
          .get(capabilityId) as { capability_id: string } | undefined;
        const readinessVerify = db
          .prepare("SELECT readiness_id FROM sora_edge_readiness WHERE grant_id = ?")
          .get(grantId) as { readiness_id: string } | undefined;
        if (!grantVerify || !capabilityVerify || !readinessVerify) {
          throw new Error(REASON_AFFECTED_ROWS);
        }
        result = {
          ok: true,
          grantId,
          delegationId,
          authorityId: edgeResult.authorityId,
          capabilityId,
          transactionRunId: callerRunId,
          readinessRecorded: true,
        };
      },
      options,
      { operationLabel: "sora-governed.issuance" },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return issuanceFailure(
      ISSUANCE_ERROR_REASONS.has(message) ? message : REASON_UNEXPECTED,
      message,
    );
  }
  return result;
}

/**
 * Production possession-resolving issuance entry (B2).
 *
 * The legitimate internal path by which live runtime-owned possession
 * reaches the authoritative issuance seam. It:
 *
 * 1. resolves the live `ActiveGovernedParentHandle` via
 *    `resolvePossessedGovernedParentForRun` — which requires the process-local
 *    handle, the current lifecycle generation, AND the runtime-owned
 *    AsyncLocalStorage execution context (absent for HTTP/RPC/tool-arg
 *    dispatch);
 * 2. creates the ACTIVE governed transaction bound to that exact handle
 *    (authoritative caller binding derived from the handle, never caller
 *    input);
 * 3. delegates to the ONE production writer
 *    `issueGovernedSubdelegationGrant(...)` with no explicit G1 request —
 *    the canonical Phase-A derivation is performed inside the transaction.
 *
 * It never accepts a serialized handle, never trusts caller-supplied
 * identifiers for possession, and is the exact internal boundary the spawn
 * path uses. The grantee (child) session key is the only caller-supplied
 * value, and it is only a target identifier, never an authority.
 */
export function issueGovernedSubdelegationForParentRun(params: {
  parentRunId: string;
  parentSessionKey: string;
  granteeSessionKey: string;
}): GovernedIssuanceResult {
  const handle = resolvePossessedGovernedParentForRun({
    runId: params.parentRunId,
    sessionKey: params.parentSessionKey,
  });
  if (!handle) {
    return issuanceFailure(
      REASON_HANDLE_NOT_LIVE,
      "runtime-owned parent possession is not live in this execution context",
    );
  }
  let transaction: GovernedTransaction;
  try {
    transaction = createGovernedTransaction({ handle });
  } catch (error) {
    return issuanceFailure(
      REASON_TXN_NOT_ACTIVE,
      error instanceof Error ? error.message : String(error),
    );
  }
  return issueGovernedSubdelegationGrant({
    handle,
    transaction,
    grant: {
      granteeSessionKey: params.granteeSessionKey,
      holderSessionKey: params.granteeSessionKey,
    },
  });
}

/**
 * Spawn-path issuance entry (B2 wiring).
 *
 * Called from the C1→G1 subdelegation spawn boundary (subagent spawn) when a
 * governed subdelegation envelope is present. Resolves the live parent
 * possession for the parent run, issues the governed grant (capability +
 * edge + readiness in one transaction), and returns the capability/delegation
 * identities the existing Phase-A spawn gate consumes. If possession or
 * issuance fails, the spawn is refused — the caller must not proceed.
 */
export function issueGovernedSubdelegationForSpawn(params: {
  parentRunId: string;
  parentSessionKey: string;
  granteeSessionKey: string;
}): GovernedIssuanceResult {
  return issueGovernedSubdelegationForParentRun(params);
}
