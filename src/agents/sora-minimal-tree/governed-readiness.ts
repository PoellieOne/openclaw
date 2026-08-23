/**
 * Governed readiness (Phase B1).
 *
 * Readiness is DERIVATIVE EVIDENCE of a valid governed state/grant
 * relationship, never an authority source:
 *
 *   READINESS != AUTHORITY
 *
 * - `readGovernedEdgeReadiness` re-reads the grant + parent edge + lifecycle
 *   generation under the same read; any missing, revoked, closed, consumed,
 *   or stale-grant state makes readiness unusable.
 * - `revokeGovernedReadiness` flips the readiness row and (in the same write
 *   transaction) the underlying grant to a terminal state, so readiness
 *   cannot survive revocation/closure.
 * - Readiness is only ever consulted alongside live possession checks at the
 *   runtime seam; a readiness row alone never authorizes anything.
 */
import type { OpenClawStateDatabaseOptions } from "../../state/openclaw-state-db.js";
import { runOpenClawStateWriteTransaction } from "../../state/openclaw-state-db.js";
import { loadSoraDelegationEdge } from "./delegation-edge.js";
import type { ActiveGovernedParentHandle } from "./governed-parent-context.js";
import { isActiveGovernedParentHandle } from "./governed-parent-context.js";
import { ensureSoraMinimalTreeSchema } from "./store.js";

export type GovernedReadiness = {
  readinessId: string;
  grantId: string;
  delegationId: string;
  authorityId: string;
  lifecycleGeneration: string;
  status: "READY" | "REVOKED" | "CLOSED";
  createdAt: number;
  updatedAt: number;
};

export type ReadinessResolution =
  | { ok: true; readiness: GovernedReadiness }
  | { ok: false; reason: string; detail?: string };

const REASON_NO_HANDLE = "handle-not-live-possession";
const REASON_NOT_READY = "readiness-not-usable";
const REASON_GRANT_CLOSED = "grant-not-usable";
const REASON_EDGE_REVOKED = "parent-edge-revoked";
const REASON_GENERATION = "lifecycle-generation-mismatch";

function readinessFailure(reason: string, detail?: string): ReadinessResolution {
  return { ok: false, reason, ...(detail ? { detail } : {}) };
}

/**
 * Resolves readiness evidence. Requires the live process-local handle (the
 * readiness is bound to the same governed parent possession), an ACTIVE
 * status, a live grant, and an un-revoked parent edge. All checks are
 * performed inside one immediate transaction so a concurrent revocation can
 * never race the read (same TOCTOU-safe pattern as Phase-A canonicalization).
 */
export function resolveGovernedReadiness(params: {
  handle: ActiveGovernedParentHandle;
  grantId: string;
  options?: OpenClawStateDatabaseOptions;
}): ReadinessResolution {
  if (!isActiveGovernedParentHandle(params.handle)) {
    return readinessFailure(REASON_NO_HANDLE);
  }
  const options = params.options ?? {};
  let resolution: ReadinessResolution = readinessFailure(REASON_NOT_READY);
  try {
    ensureSoraMinimalTreeSchema(options);
    runOpenClawStateWriteTransaction(
      ({ db }) => {
        const readinessRow = db
          .prepare("SELECT * FROM sora_edge_readiness WHERE grant_id = ?")
          .get(params.grantId) as Record<string, unknown> | undefined;
        if (!readinessRow) {
          throw new Error(REASON_NOT_READY);
        }
        if (
          readinessRow.status !== "READY" ||
          readinessRow.lifecycle_generation !== params.handle.lifecycleGeneration
        ) {
          throw new Error(REASON_GENERATION);
        }
        const grantRow = db
          .prepare("SELECT * FROM governed_subdelegation_grants WHERE grant_id = ?")
          .get(params.grantId) as Record<string, unknown> | undefined;
        if (
          !grantRow ||
          grantRow.status !== "ACTIVE" ||
          grantRow.lifecycle_generation !== params.handle.lifecycleGeneration
        ) {
          throw new Error(REASON_GRANT_CLOSED);
        }
        const edge = loadSoraDelegationEdge(String(grantRow.delegation_id), options);
        if (!edge || edge.revocationReason) {
          throw new Error(REASON_EDGE_REVOKED);
        }
        resolution = {
          ok: true,
          readiness: {
            readinessId: String(readinessRow.readiness_id),
            grantId: params.grantId,
            delegationId: String(grantRow.delegation_id),
            authorityId: String(grantRow.authority_id),
            lifecycleGeneration: params.handle.lifecycleGeneration,
            status: "READY",
            createdAt: Number(readinessRow.created_at),
            updatedAt: Number(readinessRow.updated_at),
          },
        };
      },
      options,
      { operationLabel: "sora-governed.readiness.resolve" },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return readinessFailure(
      message === REASON_GENERATION ||
        message === REASON_GRANT_CLOSED ||
        message === REASON_EDGE_REVOKED
        ? message
        : REASON_NOT_READY,
      message,
    );
  }
  return resolution;
}

/**
 * Marks a readiness row unusable and closes its grant in one transaction.
 * After this, `resolveGovernedReadiness` fails closed; the readiness can
 * never survive revocation/closure.
 */
export function revokeGovernedReadiness(params: {
  grantId: string;
  reason: string;
  now?: number;
  options?: OpenClawStateDatabaseOptions;
}): RevokeGovernedReadinessResult {
  if (!params.grantId.trim() || !params.reason.trim()) {
    return { ok: false, reason: "revocation requires the exact grant identity and a reason" };
  }
  const now = params.now ?? Date.now();
  let readinessClosed = 0;
  let grantClosed = 0;
  try {
    ensureSoraMinimalTreeSchema(params.options ?? {});
    runOpenClawStateWriteTransaction(
      ({ db }) => {
        const readinessUpdate = db
          .prepare(
            `UPDATE sora_edge_readiness
             SET status = 'REVOKED', updated_at = ?
             WHERE grant_id = ? AND status = 'READY'`,
          )
          .run(now, params.grantId);
        readinessClosed = Number(readinessUpdate.changes);
        const grantUpdate = db
          .prepare(
            `UPDATE governed_subdelegation_grants
             SET status = 'CLOSED', updated_at = ?
             WHERE grant_id = ? AND status = 'ACTIVE'`,
          )
          .run(now, params.grantId);
        grantClosed = Number(grantUpdate.changes);
      },
      params.options ?? {},
      { operationLabel: "sora-governed.readiness.revoke" },
    );
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, readinessClosed, grantClosed };
}

/** Import-time guard: this module never mints authority; only the issuance seam does. */
export const GOVERNED_READINESS_ROUTE = "sora-minimal-tree-v1";

export type RevokeGovernedReadinessResult =
  | { ok: true; readinessClosed: number; grantClosed: number }
  | { ok: false; reason: string };
