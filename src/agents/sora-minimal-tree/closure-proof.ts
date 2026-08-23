/**
 * Proof counters / closure state (T4).
 *
 * Deterministic, derivation-based closure proof for the bounded minimal tree.
 * No artificial stored counters are added: every property is derived from the
 * durable edge rows, capability rows, integration rows, and the existing
 * S21/S22 subagent run registry (read-only).
 *
 * Standing delegation authority is defined from liveness/usability semantics:
 * only a currently usable grant instrument counts — an UNCONSUMED capability
 * whose issuing edge is not revoked, an un-revoked edge still carrying
 * further-delegation rights, or an anomalous G1 edge carrying a delegable
 * ceiling. HISTORICAL_OR_CLOSED_DELEGATION_STRUCTURE (a consumed capability,
 * an integrated/classified delegation tree) does NOT count as standing
 * authority.
 *
 * G1 result production or transport can never canonicalize anything;
 * canonicalization is only recorded through an explicit governed integration
 * classification.
 *
 * Descendant runs count as OPEN unless their execution status is the sole
 * terminal status. `interrupted` is NON-TERMINAL and RESUMABLE (subagent
 * orphan recovery reclassifies interrupted runs and sends a synthetic resume
 * message), so an interrupted descendant keeps closure open just like queued
 * and running. Unknown/absent status fails closed (counted open) so a future
 * non-terminal status can never silently become "closed".
 *
 * Canonicalization grants are standing authority: a usable (unused, unrevoked,
 * live-edge-backed) single-purpose canonicalization grant is a currently
 * usable grant instrument and must block closure. Used/revoked grants are
 * historical evidence; an unused grant whose governing edge is revoked is
 * effectively unusable; a dangling/malformed grant fails closed. Closure
 * therefore proves COMPLETED_INTEGRATION => NO_RESIDUAL_CANONICALIZATION_AUTHORITY.
 */
import type { OpenClawStateDatabaseOptions } from "../../state/openclaw-state-db.js";
import { loadSubagentRunsForControllerFromSqlite } from "../subagent-registry.store.sqlite.js";
import {
  canonicalizationGrantRowToRecord,
  capabilityRowToRecord,
  edgeRowToRecord,
  integrationRowToRecord,
  openSoraMinimalTreeStore,
  type SoraC1G1CapabilityRow,
  type SoraCanonicalizationGrantRow,
  type SoraDelegationEdgeRow,
  type SoraIntegrationObjectRow,
} from "./store.js";

export type SoraIntegrationFinalState =
  | "NONE"
  | "TRANSPORT_RECEIVED"
  | "CLASSIFIED"
  | "INTEGRATED"
  | "REJECTED";

export type SoraClosureProof = {
  routeId: string;
  retryCount: number;
  fallbackCount: number;
  subdelegationCapability: "UNUSED" | "CONSUMED";
  capabilityUseCount: number;
  authorizedDescendantCount: number;
  actualDescendantCount: number;
  openDescendantTransactionCount: number;
  maxObservedDepth: number;
  unexpectedSpawnCount: number;
  /** Currently usable (live) standing delegation authority; liveness-based. */
  standingDelegationAuthority: number;
  /** Historical/closed delegation structure: consumed grant instruments. */
  historicalDelegationStructure: number;
  revokedDelegationEdgeCount: number;
  /** Canonicalization-grant accounting (Blocker C2). */
  totalCanonicalizationGrantCount: number;
  liveCanonicalizationGrantCount: number;
  usedCanonicalizationGrantCount: number;
  revokedCanonicalizationGrantCount: number;
  effectivelyRevokedCanonicalizationGrantCount: number;
  danglingCanonicalizationGrantCount: number;
  c1HasFurtherDelegationAuthority: boolean;
  g1HasFurtherDelegationAuthority: boolean;
  g1IntegrationState: SoraIntegrationFinalState;
  p0C1IntegrationState: SoraIntegrationFinalState;
  closureComplete: boolean;
};

type SoraIntegrationRecord = {
  kind: "P0_C1" | "C1_G1";
  classification: "ACCEPTED" | "REJECTED" | "PENDING";
  integrationStatus: "TRANSPORT_RECEIVED" | "CLASSIFIED" | "INTEGRATED" | "REJECTED";
};

function isGovernedFinalIntegrationState(record: SoraIntegrationRecord | undefined): boolean {
  if (!record) {
    return false;
  }
  if (record.classification !== "ACCEPTED") {
    return false;
  }
  return record.integrationStatus === "CLASSIFIED" || record.integrationStatus === "INTEGRATED";
}

/**
 * Derives the closure-state proof for one C1 session (the bounded parent of
 * the single G1 transaction). Reads only the minimal-tree tables plus the
 * read-only S21/S22 run registry; never writes, never reinterprets ordinary
 * records.
 */
export function resolveSoraMinimalTreeClosureProof(params: {
  rootDelegationId: string;
  c1SessionKey: string;
  options?: OpenClawStateDatabaseOptions;
}): SoraClosureProof {
  const options = params.options ?? {};
  const { database } = openSoraMinimalTreeStore(options);

  const edgeRows = database.db
    .prepare(
      "SELECT * FROM sora_delegation_edges WHERE root_delegation_id = ? ORDER BY created_at ASC",
    )
    .all(params.rootDelegationId) as unknown as SoraDelegationEdgeRow[];
  const edgeRecords = edgeRows
    .map((row) => edgeRowToRecord(row))
    .filter((record) => record !== undefined);

  const capabilityRows = database.db
    .prepare(
      `SELECT c.* FROM sora_c1_g1_capabilities c
       JOIN sora_delegation_edges e ON e.delegation_id = c.issue_delegation_id
       WHERE e.root_delegation_id = ? ORDER BY c.created_at ASC`,
    )
    .all(params.rootDelegationId) as unknown as SoraC1G1CapabilityRow[];
  const capabilities = capabilityRows
    .map((row) => capabilityRowToRecord(row))
    .filter((record) => record !== undefined);

  const integrationRows = database.db
    .prepare(
      `SELECT i.* FROM sora_integration_objects i
       JOIN sora_delegation_edges e ON e.delegation_id = i.delegation_id
       WHERE e.root_delegation_id = ? ORDER BY i.created_at ASC`,
    )
    .all(params.rootDelegationId) as unknown as SoraIntegrationObjectRow[];
  const integrationRecords = integrationRows
    .map((row) => integrationRowToRecord(row))
    .filter((record) => record !== undefined);

  const grantRows = database.db // sqlite-allow-raw -- tree-attributed canonicalization-grant read for closure accounting.
    .prepare(
      "SELECT * FROM sora_canonicalization_grants WHERE root_delegation_id = ? ORDER BY created_at ASC",
    )
    .all(params.rootDelegationId) as unknown as SoraCanonicalizationGrantRow[];
  const grantRecords = grantRows
    .map((row) => canonicalizationGrantRowToRecord(row))
    .filter((record) => record !== undefined);
  // Malformed grant rows (unparseable/partial) fail closed: they are counted
  // as dangling evidence and can never be silently ignored.
  const malformedGrantCount = grantRows.length - grantRecords.length;

  const c1Edges = edgeRecords.filter((edge) => edge.edgeKind === "P0_C1");
  const g1Edges = edgeRecords.filter((edge) => edge.edgeKind === "C1_G1");

  const revokedEdgeIds = new Set(
    edgeRows
      .filter((row) => row.revocation_reason != null && row.revocation_reason !== "")
      .map((row) => row.delegation_id),
  );
  const edgeIds = new Set(edgeRows.map((row) => row.delegation_id));

  const retryCount =
    edgeRows.some((row) => row.retry_allowed === 1) ||
    capabilityRows.some((row) => row.retry_allowed === 1)
      ? 1
      : 0;
  const fallbackCount =
    edgeRows.some((row) => row.fallback_allowed === 1) ||
    capabilityRows.some((row) => row.fallback_allowed === 1)
      ? 1
      : 0;

  const capability = capabilities.find((entry) => entry !== undefined);
  const capabilityUseCount = capabilities.filter((entry) => entry.consumed).length;
  const authorizedDescendantCount = capabilities.reduce(
    (sum, entry) => sum + entry.maxDescendants,
    0,
  );
  const actualDescendantCount = g1Edges.length;
  const maxObservedDepth = edgeRecords.reduce((max, edge) => Math.max(max, edge.depth), 0);

  const g1HasFurtherDelegationAuthority = g1Edges.some(
    (edge) => edge.authority.delegableCeiling || edge.furtherDelegationAllowed,
  );
  const c1HasFurtherDelegationAuthority = c1Edges.some(
    (edge) => edge.authority.delegableCeiling || edge.furtherDelegationAllowed,
  );
  const unexpectedSpawnCount =
    g1Edges.length > 1 || g1Edges.some((edge) => edge.depth !== 2) ? 1 : 0;

  // Liveness-based standing authority: only currently usable instruments count.
  const liveCapability = capabilities.some(
    (entry) => !entry.consumed && !revokedEdgeIds.has(entry.issueDelegationId),
  );
  const liveFurtherDelegationRight = edgeRows.some(
    (row) => row.further_delegation_allowed === 1 && !revokedEdgeIds.has(row.delegation_id),
  );
  const anomalousG1Ceiling = g1Edges.some((edge) => edge.authority.delegableCeiling === true);

  // Canonicalization-grant accounting (Blocker C2). A grant is LIVE standing
  // authority only when it is unused, unrevoked, and its governing edge is
  // live AND present. Used/revoked grants are historical evidence. An unused
  // grant whose edge is revoked is effectively revoked (unusable). A grant
  // whose edge is missing, or a malformed grant row, is dangling and fails
  // closed — dangling grants never count as live (no governing edge exists).
  const usedCanonicalizationGrantCount = grantRecords.filter((grant) => grant.used).length;
  const revokedCanonicalizationGrantCount = grantRecords.filter((grant) => grant.revoked).length;
  const effectivelyRevokedCanonicalizationGrantCount = grantRecords.filter(
    (grant) => !grant.used && !grant.revoked && revokedEdgeIds.has(grant.delegationId),
  ).length;
  const danglingCanonicalizationGrantCount = grantRecords.filter(
    (grant) => !grant.used && !grant.revoked && !edgeIds.has(grant.delegationId),
  ).length;
  const liveCanonicalizationGrantCount = grantRecords.filter(
    (grant) =>
      !grant.used &&
      !grant.revoked &&
      !revokedEdgeIds.has(grant.delegationId) &&
      edgeIds.has(grant.delegationId),
  ).length;
  const totalCanonicalizationGrantCount = grantRows.length;

  const standingDelegationAuthority =
    (liveCapability ? 1 : 0) +
    (liveFurtherDelegationRight ? 1 : 0) +
    (anomalousG1Ceiling ? 1 : 0) +
    liveCanonicalizationGrantCount;

  // Historical/closed structure: consumed grant instruments and revoked edges.
  const historicalDelegationStructure =
    capabilities.filter((entry) => entry.consumed).length +
    revokedEdgeIds.size +
    usedCanonicalizationGrantCount +
    revokedCanonicalizationGrantCount +
    effectivelyRevokedCanonicalizationGrantCount;

  const liveDescendantRuns = loadSubagentRunsForControllerFromSqlite(params.c1SessionKey);
  // Only `terminal` is a closed descendant. Every other registry execution
  // status (queued, running, interrupted, absent, or unknown) stays open:
  // interrupted is non-terminal/resumable via orphan recovery, and fail-closed
  // here means a new non-terminal status can never evade the open count.
  const openDescendantTransactionCount = liveDescendantRuns.filter(
    (run: { execution?: { status?: string } }) => run.execution?.status !== "terminal",
  ).length;

  const g1Integration = integrationRecords.find((record) => record.kind === "C1_G1");
  const p0C1Integration = integrationRecords.find((record) => record.kind === "P0_C1");
  const g1IntegrationState = (g1Integration?.integrationStatus ??
    "NONE") as SoraIntegrationFinalState;
  const p0C1IntegrationState = (p0C1Integration?.integrationStatus ??
    "NONE") as SoraIntegrationFinalState;

  const closureComplete =
    // exactly one capability, consumed exactly once
    capabilities.length === 1 &&
    capability !== undefined &&
    capability.consumed === true &&
    capabilityUseCount === 1 &&
    // retry/fallback prohibition
    retryCount === 0 &&
    fallbackCount === 0 &&
    // descendant/count bounds
    actualDescendantCount <= authorizedDescendantCount &&
    unexpectedSpawnCount === 0 &&
    openDescendantTransactionCount === 0 &&
    // depth bound
    maxObservedDepth <= 2 &&
    // no currently usable standing delegation authority, including no
    // usable canonicalization grant and no dangling/malformed grant evidence
    standingDelegationAuthority === 0 &&
    liveCanonicalizationGrantCount === 0 &&
    danglingCanonicalizationGrantCount === 0 &&
    malformedGrantCount === 0 &&
    // governed integration to the required final state, bottom-up:
    // G1 closure -> C1 governed integration -> C1 descendant-informed result
    // -> P0 governed integration -> P0/C1 closure
    isGovernedFinalIntegrationState(g1Integration) &&
    isGovernedFinalIntegrationState(p0C1Integration) &&
    // required edge/lifecycle closure conditions
    c1Edges.length === 1 &&
    g1Edges.length === 1 &&
    revokedEdgeIds.size === 0;

  return {
    routeId: "sora-minimal-tree-v1",
    retryCount,
    fallbackCount,
    subdelegationCapability: capability ? (capability.consumed ? "CONSUMED" : "UNUSED") : "UNUSED",
    capabilityUseCount,
    authorizedDescendantCount,
    actualDescendantCount,
    openDescendantTransactionCount,
    maxObservedDepth,
    unexpectedSpawnCount,
    standingDelegationAuthority,
    historicalDelegationStructure,
    revokedDelegationEdgeCount: revokedEdgeIds.size,
    totalCanonicalizationGrantCount,
    liveCanonicalizationGrantCount,
    usedCanonicalizationGrantCount,
    revokedCanonicalizationGrantCount,
    effectivelyRevokedCanonicalizationGrantCount,
    danglingCanonicalizationGrantCount,
    c1HasFurtherDelegationAuthority,
    g1HasFurtherDelegationAuthority,
    g1IntegrationState,
    p0C1IntegrationState,
    closureComplete,
  };
}
