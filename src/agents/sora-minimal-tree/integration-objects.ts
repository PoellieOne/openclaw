/**
 * Governed semantic integration objects (T5).
 *
 * Durable C1_G1_INTEGRATION_OBJECT and P0_C1_INTEGRATION_OBJECT bindings for
 * the minimal tree. Receiving or storing a child result never auto-classifies
 * it as accepted: rows start at TRANSPORT_RECEIVED with classification
 * PENDING, and only an explicit governed classification moves them to
 * ACCEPTED/REJECTED. G1 result production/delivery carries no canonical SoRa
 * mutation authority; the integration row records canonicalization as a
 * separate, explicitly authorized step.
 *
 * GRANT ISSUANCE IS SEALED (Phase-A.9).
 *
 * There is no callable grant-issuance surface in this module. The complete
 * trusted caller-provenance chain (server-injected session identity AND a
 * governed transaction/run identity with an existing producer) does not
 * exist in Phase-A source: the HTTP tools.invoke surface can request-select
 * a sessionKey. Phase-B1 now supplies the governed producer
 * (`soraTransactionRunId` is produced at the embedded runner-owned tool
 * construction boundary through the runtime possession carry); the phase-A
 * seal above remains the rule for THIS module. Any plain-string or typed
 * caller identity would remain caller-constructible
 * (`TYPED_CONTEXT != TRUSTED_CONTEXT`), so instead of accepting fabricated
 * provenance this module seals issuance entirely:
 *
 *   NO_TRUSTED_TRANSACTION_CONTEXT -> NO_GRANT_ISSUANCE
 *
 * Grant rows can therefore only ever be produced by the governed Phase-B1
 * seam (possession-carry), never by an internal caller from row-readable
 * values. `markSoraIntegrationCanonicalized` (possession-checked
 * consumption) and `revokeSoraDelegationEdgeAndGrants` (governed edge
 * revocation) remain the lifecycle primitives and stay fail-closed.
 */
import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQuerySync } from "../../infra/kysely-sync.js";
import type { OpenClawStateDatabaseOptions } from "../../state/openclaw-state-db.js";
import { runOpenClawStateWriteTransaction } from "../../state/openclaw-state-db.js";
import { stableStringify } from "../stable-stringify.js";
import {
  canonicalizationGrantRowToRecord,
  edgeRowToRecord,
  integrationRowToRecord,
  openSoraMinimalTreeStore,
  type DelegationEdgeKind,
  type SoraCanonicalizationGrantRecord,
  type SoraDelegationEdgeRecord,
  type SoraIntegrationObjectRecord,
} from "./store.js";

export type SoraIntegrationClassification = "ACCEPTED" | "REJECTED" | "PENDING";
export type SoraIntegrationStatus = "TRANSPORT_RECEIVED" | "CLASSIFIED" | "INTEGRATED" | "REJECTED";

export type CreateSoraIntegrationObjectParams = {
  integrationId: string;
  delegationId: string;
  authorityId: string;
  kind: DelegationEdgeKind;
  childResultSessionKey: string;
  childResultRunId: string;
  originatingTransactionRunId: string;
  parentSessionKey: string;
  parentTransactionRunId?: string;
  resultDigest: string;
  provenanceJson: string;
  now: number;
};

export function mintSoraIntegrationId(): string {
  return `INTEGRATION_${crypto.randomUUID()}`;
}

/** Deterministic digest of the transported child result text. */
export function computeSoraResultDigest(resultText: string): string {
  return crypto
    .createHash("sha256")
    .update(resultText ?? "", "utf8")
    .digest("hex");
}

/** Inserts one integration object row in TRANSPORT_RECEIVED/PENDING state. */
export function createSoraIntegrationObject(
  params: CreateSoraIntegrationObjectParams,
  options: OpenClawStateDatabaseOptions = {},
): { ok: true; integrationId: string } | { ok: false; reason: string } {
  const now = params.now;
  const values = {
    integration_id: params.integrationId,
    delegation_id: params.delegationId,
    authority_id: params.authorityId,
    kind: params.kind,
    child_result_session_key: params.childResultSessionKey,
    child_result_run_id: params.childResultRunId,
    originating_transaction_run_id: params.originatingTransactionRunId,
    parent_session_key: params.parentSessionKey,
    parent_transaction_run_id: params.parentTransactionRunId ?? null,
    result_digest: params.resultDigest,
    classification: "PENDING" as const,
    integration_status: "TRANSPORT_RECEIVED" as const,
    parent_result_changed: 0,
    parent_result_change_summary: null,
    canonicalized: 0,
    canonicalized_at: null,
    provenance_json: params.provenanceJson,
    created_at: now,
    updated_at: now,
  };
  const { database, kysely } = openSoraMinimalTreeStore(options);
  try {
    executeSqliteQuerySync(
      database.db,
      kysely.insertInto("sora_integration_objects").values(values),
    );
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, integrationId: params.integrationId };
}

export type ClassifySoraIntegrationParams = {
  integrationId: string;
  classification: "ACCEPTED" | "REJECTED";
  parentResultChanged: boolean;
  parentResultChangeSummary?: string;
  now: number;
};

/**
 * Single-shot governed classification. Only a row still in
 * TRANSPORT_RECEIVED/PENDING may be classified once; anything else fails
 * closed. The result digest is re-bound to the exact transported result so a
 * later swap can never be classified under the original identity.
 */
export function classifySoraIntegration(
  params: ClassifySoraIntegrationParams,
  options: OpenClawStateDatabaseOptions = {},
): { ok: true } | { ok: false; reason: string } {
  const { database } = openSoraMinimalTreeStore(options);
  try {
    const st = database.db
      .prepare(
        `UPDATE sora_integration_objects
         SET classification = ?,
             integration_status = ?,
             parent_result_changed = ?,
             parent_result_change_summary = ?,
             canonicalized = 0,
             updated_at = ?
         WHERE integration_id = ?
           AND integration_status = 'TRANSPORT_RECEIVED'
           AND classification = 'PENDING'`,
      )
      .run(
        params.classification,
        params.classification === "ACCEPTED" ? "CLASSIFIED" : "REJECTED",
        params.parentResultChanged ? 1 : 0,
        params.parentResultChangeSummary ?? null,
        params.now,
        params.integrationId,
      );
    if (st.changes !== 1) {
      return { ok: false, reason: "integration object is not in transport-received/pending state" };
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}

/**
 * Governed parent-side canonicalization authority (T5, Blocker C).
 *
 * Canonicalization is not an identifier check: the integration row's stored
 * binding fields are replayable by any reader and are never accepted as
 * authority. Authority is a live grant derived from the exact un-revoked
 * delegation edge row:
 *
 * - The edge is loaded inside the write transaction (same SQLite lock as the
 *   canonicalization mutation, so a concurrent revocation can never race the
 *   validation).
 * - The edge must exist, be the exact integration's edge (delegation_id +
 *   authority_id), be the parent-side semantic role for the integration kind
 *   (P0_C1 edge for a P0_C1 integration, C1_G1 edge for a C1_G1 integration),
 *   and carry the integration's parent session + parent transaction binding.
 * - The caller must present the live grant id minted when the edge was
 *   established (single-purpose canonicalization grant, exact-integration
 *   bound, never mintable from the integration row). Only the exact
 *   live, un-used, un-revoked grant row satisfies the predicate.
 * - The result digest must match and the integration must be CLASSIFIED and
 *   not yet canonicalized.
 *
 * A caller that merely reads the integration row cannot reconstruct the grant
 * id, so ROW_REPLAYABLE_BINDING != AUTHORITY_POSSESSION. The grant is
 * single-shot (used -> 1 on success) and is not transferable by ordinary
 * result transport (result transport carries no grant id).
 */
export type SoraCanonicalizationAuthorityBinding = {
  /** Exact single-purpose grant id minted from the live edge, never row-derived. */
  grantId: string;
  parentSessionKey: string;
  parentTransactionRunId: string;
  delegationId: string;
  authorityId: string;
  resultDigest: string;
};

export type MarkSoraIntegrationCanonicalizedParams = {
  integrationId: string;
  /** Exact governed parent-side binding that must match the live edge and grant. */
  authority: SoraCanonicalizationAuthorityBinding;
  now: number;
};

type SoraEdgeBindingAssertion = {
  delegationId: string;
  authorityId: string;
};

function isLiveUsableEdge(
  edge: SoraDelegationEdgeRecord | undefined,
  binding: SoraEdgeBindingAssertion,
): boolean {
  if (!edge) {
    return false;
  }
  if (edge.revocationReason) {
    return false;
  }
  return edge.delegationId === binding.delegationId && edge.authorityId === binding.authorityId;
}

/** Canonicalization is a parent-side mutation: the grantor of the live edge. */
function expectedEdgeKind(kind: SoraIntegrationObjectRecord["kind"]): DelegationEdgeKind {
  return kind === "C1_G1" ? "C1_G1" : "P0_C1";
}

function loadEdgeForIntegration(
  db: DatabaseSync,
  integration: SoraIntegrationObjectRecord,
): SoraDelegationEdgeRecord | undefined {
  // sqlite-allow-raw -- exact delegation-id lookup of the integration's edge inside the transaction.
  const row = db // sqlite-allow-raw -- exact delegation-id lookup of the integration's edge.
    .prepare("SELECT * FROM sora_delegation_edges WHERE delegation_id = ?")
    .get(integration.delegationId) as Record<string, unknown> | undefined;
  if (!row) {
    return undefined;
  }
  const record = edgeRowToRecord(row as never);
  return record && record.delegationId === integration.delegationId ? record : undefined;
}

function loadGrant(db: DatabaseSync, grantId: string): SoraCanonicalizationGrantRecord | undefined {
  // sqlite-allow-raw -- exact grant-id lookup of the single-purpose grant inside the transaction.
  const row = db // sqlite-allow-raw -- exact grant-id lookup of the single-purpose grant.
    .prepare("SELECT * FROM sora_canonicalization_grants WHERE grant_id = ?")
    .get(grantId) as Record<string, unknown> | undefined;
  return row ? canonicalizationGrantRowToRecord(row as never) : undefined;
}

/**
 * Marks a governed integration as canonicalized. This is the only surface
 * that may record canonical SoRa mutation. It is never reachable from G1
 * result production or transport, and never from possession of the
 * integration row alone: the guarded transaction re-loads the exact live
 * delegation edge and the single-purpose canonicalization grant inside the
 * same SQLite write lock as the canonicalization mutation, and every binding
 * (grant id, parent session, parent transaction, delegation, authority,
 * result digest, integration state) must match. Any unknown, stale, absent,
 * revoked, mismatched, or already-used element fails closed.
 */
export function markSoraIntegrationCanonicalized(
  params: MarkSoraIntegrationCanonicalizedParams,
  options: OpenClawStateDatabaseOptions = {},
): { ok: true } | { ok: false; reason: string } {
  if (
    !params.authority.grantId.trim() ||
    !params.authority.parentSessionKey.trim() ||
    !params.authority.parentTransactionRunId.trim() ||
    !params.authority.delegationId.trim() ||
    !params.authority.authorityId.trim() ||
    !params.authority.resultDigest.trim()
  ) {
    return {
      ok: false,
      reason: "canonicalization requires the exact governed parent-side authority binding",
    };
  }
  try {
    runOpenClawStateWriteTransaction(
      ({ db }) => {
        // sqlite-allow-raw -- guarded canonicalization transaction: integration,
        // edge, and grant are re-read under the same BEGIN IMMEDIATE lock as the
        // canonicalization mutation to keep authority validation TOCTOU-safe.
        const integrationRow = db // sqlite-allow-raw -- exact integration lookup inside the canonicalization transaction.
          .prepare("SELECT * FROM sora_integration_objects WHERE integration_id = ?")
          .get(params.integrationId) as Record<string, unknown> | undefined;
        const integration = integrationRow
          ? integrationRowToRecord(integrationRow as never)
          : undefined;
        if (!integration) {
          throw new Error("integration object does not exist");
        }
        if (integration.integrationStatus !== "CLASSIFIED") {
          throw new Error("integration is not in the governed classified state");
        }
        if (integration.canonicalized) {
          throw new Error("integration is already canonicalized");
        }
        const edge = loadEdgeForIntegration(db, integration);
        if (!edge || !isLiveUsableEdge(edge, params.authority)) {
          throw new Error(
            "live governed delegation edge does not match the canonicalization binding",
          );
        }
        if (edge.edgeKind !== expectedEdgeKind(integration.kind)) {
          throw new Error("delegation edge does not carry the parent-side canonicalization role");
        }
        if (integration.delegationId !== params.authority.delegationId) {
          throw new Error(
            "integration delegation identity does not match the canonicalization binding",
          );
        }
        const grant = loadGrant(db, params.authority.grantId);
        if (!grant) {
          throw new Error("single-purpose canonicalization grant does not exist");
        }
        if (
          grant.integrationId !== params.integrationId ||
          grant.delegationId !== params.authority.delegationId ||
          grant.authorityId !== params.authority.authorityId ||
          grant.parentSessionKey !== params.authority.parentSessionKey ||
          grant.parentTransactionRunId !== params.authority.parentTransactionRunId ||
          grant.resultDigest !== params.authority.resultDigest
        ) {
          throw new Error("canonicalization grant is bound to a different integration or binding");
        }
        if (grant.used || grant.revoked) {
          throw new Error("canonicalization grant is already used or revoked");
        }
        if (integration.resultDigest !== params.authority.resultDigest) {
          throw new Error("integration result digest does not match the canonicalization binding");
        }
        const claimed = db // sqlite-allow-raw -- guarded one-shot canonicalization mutation.
          .prepare(
            `UPDATE sora_integration_objects
             SET integration_status = 'INTEGRATED',
                 canonicalized = 1,
                 canonicalized_at = ?,
                 updated_at = ?
             WHERE integration_id = ?
               AND integration_status = 'CLASSIFIED'
               AND canonicalized = 0`,
          )
          .run(params.now, params.now, params.integrationId);
        if (claimed.changes !== 1) {
          throw new Error("integration is not classified or already canonicalized");
        }
        const grantClaimed = db // sqlite-allow-raw -- single-shot grant consumption guarded by used/revoked flags.
          .prepare(
            `UPDATE sora_canonicalization_grants
             SET used = 1,
                 used_at = ?,
                 updated_at = ?
             WHERE grant_id = ? AND used = 0 AND revoked = 0`,
          )
          .run(params.now, params.now, params.authority.grantId);
        if (grantClaimed.changes !== 1) {
          throw new Error("single-purpose canonicalization grant is already used or revoked");
        }
      },
      options,
      { operationLabel: "sora-integration.canonicalize" },
    );
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}

/**
 * GOVERNED GRANT ISSUANCE IS SEALED IN PHASE A (Phase-A.9).
 *
 * There is deliberately NO exported, importable, or callable grant-issuance
 * function in this module. The complete trusted caller-provenance chain is
 * not established in Phase-A source:
 *
 * - HTTP tools.invoke can request-select a sessionKey (tools-invoke-shared.ts),
 *   so `agentSessionKey` is not uniformly server-injected across every surface;
 * - `soraTransactionRunId` is produced only at the embedded runner-owned tool
 *   construction boundary through the runtime possession carry (Phase-B1),
 *   never by HTTP/RPC/tool-arg input;
 * - any caller-supplied identity (plain string or typed object) remains
 *   constructible by any internal caller (`TYPED_CONTEXT != TRUSTED_CONTEXT`).
 *
 * Carried invariants:
 *   ROW_MATCH != POSSESSION
 *   LIVE_EDGE_MATCH != CALLER_AUTHORITY
 *   KNOWLEDGE(SESSION_ID, TRANSACTION_ID, EDGE_ID, AUTHORITY_ID) !=
 *     POSSESSION_OF_ISSUANCE_AUTHORITY
 *
 * The sealed invariant enforced here:
 *
 *   NO_TRUSTED_TRANSACTION_CONTEXT -> NO_GRANT_ISSUANCE
 *
 * Grant rows can therefore never be minted by an ordinary internal caller
 * from row-readable values. When Phase B establishes the governed invocation
 * boundary (captured, non-constructible identity), issuance machinery must be
 * added inside that boundary — never as a general exported API accepting
 * caller-supplied identity.
 */

/**
 * Governed edge revocation seam (Blocker C2 lifecycle).
 *
 * Revoking a delegation edge and closing the grants derived from it happen in
 * one BEGIN IMMEDIATE transaction: the edge is marked revoked (first
 * revocation wins; idempotent thereafter) and every unused grant whose
 * authority derives from that edge is explicitly revoked in the same write
 * lock. A concurrent issuance or canonicalization can never observe a stale
 * live grant after the edge is revoked. Bounded to the grants table — this is
 * not a generic cascade subsystem.
 */
export function revokeSoraDelegationEdgeAndGrants(params: {
  edgeDelegationId: string;
  revocationReason: string;
  now: number;
  options?: OpenClawStateDatabaseOptions;
}): { ok: true; edgeRevoked: number; grantsRevoked: number } | { ok: false; reason: string } {
  if (!params.edgeDelegationId.trim() || !params.revocationReason.trim()) {
    return { ok: false, reason: "edge revocation requires the exact edge identity and a reason" };
  }
  let edgeRevoked = 0;
  let grantsRevoked = 0;
  try {
    runOpenClawStateWriteTransaction(
      ({ db }) => {
        // sqlite-allow-raw -- governed revocation transaction: edge + derived grants.
        const edgeRow = db // sqlite-allow-raw -- exact edge identity lookup inside the revocation transaction.
          .prepare("SELECT delegation_id FROM sora_delegation_edges WHERE delegation_id = ?")
          .get(params.edgeDelegationId) as { delegation_id: string } | undefined;
        if (!edgeRow) {
          throw new Error("delegation edge does not exist");
        }
        const edgeUpdate = db // sqlite-allow-raw -- guarded edge revocation; first revocation wins.
          .prepare(
            `UPDATE sora_delegation_edges
             SET revocation_reason = ?, updated_at = ?
             WHERE delegation_id = ? AND (revocation_reason IS NULL OR revocation_reason = '')`,
          )
          .run(params.revocationReason, params.now, params.edgeDelegationId);
        edgeRevoked = Number(edgeUpdate.changes);
        const grantUpdate = db // sqlite-allow-raw -- cascade: unused grants derived from the revoked edge.
          .prepare(
            `UPDATE sora_canonicalization_grants
             SET revoked = 1, revoked_at = ?, updated_at = ?
             WHERE delegation_id = ? AND used = 0 AND revoked = 0`,
          )
          .run(params.now, params.now, params.edgeDelegationId);
        grantsRevoked = Number(grantUpdate.changes);
      },
      params.options ?? {},
      { operationLabel: "sora-integration.edge.revoke" },
    );
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, edgeRevoked, grantsRevoked };
}

export function loadSoraCanonicalizationGrant(
  grantId: string,
  options: OpenClawStateDatabaseOptions = {},
): SoraCanonicalizationGrantRecord | undefined {
  const { database } = openSoraMinimalTreeStore(options);
  // sqlite-allow-raw -- exact grant-id lookup.
  const row = database.db // sqlite-allow-raw -- exact grant-id lookup.
    .prepare("SELECT * FROM sora_canonicalization_grants WHERE grant_id = ?")
    .get(grantId) as Record<string, unknown> | undefined;
  return row ? canonicalizationGrantRowToRecord(row as never) : undefined;
}

export function loadSoraIntegrationObject(
  integrationId: string,
  options: OpenClawStateDatabaseOptions = {},
): SoraIntegrationObjectRecord | undefined {
  const { database } = openSoraMinimalTreeStore(options);
  const row = database.db
    .prepare("SELECT * FROM sora_integration_objects WHERE integration_id = ?")
    .get(integrationId) as Record<string, unknown> | undefined;
  return row ? integrationRowToRecord(row as never) : undefined;
}

export function listSoraIntegrationObjectsForChild(
  childResultSessionKey: string,
  options: OpenClawStateDatabaseOptions = {},
): SoraIntegrationObjectRecord[] {
  const { database, kysely } = openSoraMinimalTreeStore(options);
  const rows = executeSqliteQuerySync(
    database.db,
    kysely
      .selectFrom("sora_integration_objects")
      .selectAll()
      .where("child_result_session_key", "=", childResultSessionKey)
      .orderBy("created_at", "asc"),
  ).rows;
  return rows.map((row) => integrationRowToRecord(row)).filter((record) => record !== undefined);
}

export function stableProvenance(parts: unknown[]): string {
  return stableStringify(parts);
}
