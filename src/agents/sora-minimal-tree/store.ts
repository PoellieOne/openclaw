/**
 * Durable store for the bounded P0→C1→G1 minimal-tree route.
 *
 * Purely additive shared-state tables. Feature-local lazy ensure mirrors
 * `src/skills/workshop/store-sqlite-schema.ts`; the tables are declared in the
 * canonical schema source and folded into the next natural schema bump, so no
 * schema-version change is introduced here and ordinary S21/S22 subagent
 * records are never read or reinterpreted.
 */
import type { DatabaseSync } from "node:sqlite";
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import type { Selectable } from "kysely";
import { getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import type { DB as OpenClawStateDatabase } from "../../state/openclaw-state-db.generated.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "../../state/openclaw-state-db.js";
import { stableStringify } from "../stable-stringify.js";

export type SoraMinimalTreeDatabase = Pick<
  OpenClawStateDatabase,
  | "sora_delegation_edges"
  | "sora_c1_g1_capabilities"
  | "sora_integration_objects"
  | "sora_canonicalization_grants"
  | "governed_transaction_runs"
  | "authoritative_caller_bindings"
  | "governed_subdelegation_grants"
  | "sora_edge_readiness"
>;
export type SoraDelegationEdgeRow = Selectable<SoraMinimalTreeDatabase["sora_delegation_edges"]>;
export type SoraC1G1CapabilityRow = Selectable<SoraMinimalTreeDatabase["sora_c1_g1_capabilities"]>;
export type SoraIntegrationObjectRow = Selectable<
  SoraMinimalTreeDatabase["sora_integration_objects"]
>;
export type SoraCanonicalizationGrantRow = Selectable<
  SoraMinimalTreeDatabase["sora_canonicalization_grants"]
>;

export const SORA_MINIMAL_TREE_ROUTE_ID = "sora-minimal-tree-v1";
export const SORA_P0_C1_MAX_DEPTH = 1;
export const SORA_C1_G1_MAX_DEPTH_FROM_P0 = 2;
export const SORA_C1_MAX_DESCENDANTS = 1;
export const SORA_G1_MAX_DESCENDANTS = 0;

export type DelegationEdgeKind = "P0_C1" | "C1_G1";

export type SoraDelegationAuthority = {
  routeId: string;
  depth: number;
  maxDescendants: number;
  permittedToolNames: readonly string[];
  mutationNames: readonly string[];
  scope: readonly string[];
  executorKind: readonly string[];
  runtimeRoute: readonly string[];
  delegableCeiling: boolean;
  /** Durable marker set only after this exact authority was already granted downstream. */
  delegated?: true;
  token?: string;
};

export type SoraAuthorityComparison = { ok: true } | { ok: false; reason: string };

/**
 * Field-by-field subset comparison of a candidate authority against the
 * delegable ceiling. Fails closed on any dimension that is unknown, malformed,
 * missing, or wider than the ceiling. Tool availability is never consulted:
 * TOOL_CAPABILITY != AUTHORITY.
 */
export function compareSoraAuthority(
  ceiling: SoraDelegationAuthority,
  candidate: SoraDelegationAuthority,
): SoraAuthorityComparison {
  const fail = (reason: string): SoraAuthorityComparison => ({ ok: false, reason });
  if (
    ceiling.routeId !== SORA_MINIMAL_TREE_ROUTE_ID ||
    candidate.routeId !== SORA_MINIMAL_TREE_ROUTE_ID
  ) {
    return fail("route not on the bounded minimal-tree route");
  }
  if (candidate.depth !== ceiling.depth + 1) {
    return fail(
      `depth must be exactly one below the delegable ceiling (expected ${ceiling.depth + 1})`,
    );
  }
  if (candidate.depth > SORA_C1_G1_MAX_DEPTH_FROM_P0) {
    return fail("depth exceeds the minimal-tree bound");
  }
  if (candidate.maxDescendants > ceiling.maxDescendants) {
    return fail("descendant count exceeds the delegable ceiling");
  }
  if (candidate.delegableCeiling) {
    return fail("candidate authority must not carry a delegable ceiling");
  }
  if (candidate.delegated === true) {
    return fail("authority is already granted downstream");
  }
  for (const tool of candidate.permittedToolNames) {
    if (!ceiling.permittedToolNames.includes(tool)) {
      return fail(`tool ${tool} is outside the delegable ceiling`);
    }
  }
  for (const mutation of candidate.mutationNames) {
    if (!ceiling.mutationNames.includes(mutation)) {
      return fail(`mutation ${mutation} is outside the delegable ceiling`);
    }
  }
  for (const entry of candidate.scope) {
    if (!ceiling.scope.includes(entry)) {
      return fail(`scope entry ${entry} is outside the delegable ceiling`);
    }
  }
  for (const entry of candidate.executorKind) {
    if (!ceiling.executorKind.includes(entry)) {
      return fail(`executor ${entry} is outside the delegable ceiling`);
    }
  }
  for (const entry of candidate.runtimeRoute) {
    if (!ceiling.runtimeRoute.includes(entry)) {
      return fail(`runtime route ${entry} is outside the delegable ceiling`);
    }
  }
  return { ok: true };
}

export function authorityToDbJson(authority: SoraDelegationAuthority): string {
  return stableStringify(authority);
}

export function authorityFromDbJson(raw: string): SoraDelegationAuthority | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return undefined;
    }
    return parsed as unknown as SoraDelegationAuthority;
  } catch {
    return undefined;
  }
}

export type SoraDelegationEdgeRecord = {
  delegationId: string;
  authorityId: string;
  parentDelegationId?: string;
  rootDelegationId: string;
  grantorSessionKey: string;
  granteeSessionKey: string;
  grantorTransactionRunId: string;
  granteeTransactionRunId?: string;
  edgeKind: DelegationEdgeKind;
  depth: number;
  authority: SoraDelegationAuthority;
  retryAllowed: false;
  fallbackAllowed: false;
  furtherDelegationAllowed: false;
  revocationReason?: string;
  createdAt: number;
  updatedAt: number;
};

export function edgeRowToRecord(row: SoraDelegationEdgeRow): SoraDelegationEdgeRecord | undefined {
  const authority = authorityFromDbJson(row.authority_json);
  if (!authority) {
    return undefined;
  }
  const edgeKind =
    row.edge_kind === "P0_C1" || row.edge_kind === "C1_G1" ? row.edge_kind : undefined;
  if (!edgeKind) {
    return undefined;
  }
  const rootDelegationId = row.root_delegation_id ?? "";
  return {
    delegationId: row.delegation_id,
    authorityId: row.authority_id,
    ...(row.parent_delegation_id ? { parentDelegationId: row.parent_delegation_id } : {}),
    rootDelegationId,
    grantorSessionKey: row.grantor_session_key,
    granteeSessionKey: row.grantee_session_key,
    grantorTransactionRunId: row.grantor_transaction_run_id ?? "",
    ...(row.grantee_transaction_run_id
      ? { granteeTransactionRunId: row.grantee_transaction_run_id }
      : {}),
    edgeKind,
    depth: row.depth,
    authority,
    retryAllowed: false,
    fallbackAllowed: false,
    furtherDelegationAllowed: false,
    ...(row.revocation_reason ? { revocationReason: row.revocation_reason } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type SoraC1G1CapabilityRecord = {
  capabilityId: string;
  delegationId: string;
  authorityId: string;
  issueDelegationId: string;
  issueAuthorityId: string;
  grantorSessionKey: string;
  granteeSessionKey: string;
  transactionRunId: string;
  maxUses: 1;
  maxDescendants: 1;
  maxDepthFromP0: 2;
  retryAllowed: false;
  fallbackAllowed: false;
  furtherDelegationAllowed: false;
  consumed: boolean;
  reservedChildSessionKey?: string;
  reservedRunId?: string;
  consumedAt?: number;
  consumptionError?: string;
  createdAt: number;
  updatedAt: number;
};

export function capabilityRowToRecord(
  row: SoraC1G1CapabilityRow,
): SoraC1G1CapabilityRecord | undefined {
  if (row.max_uses !== 1 || row.max_descendants !== 1 || row.max_depth_from_p0 !== 2) {
    return undefined;
  }
  return {
    capabilityId: row.capability_id,
    delegationId: row.delegation_id,
    authorityId: row.authority_id,
    issueDelegationId: row.issue_delegation_id,
    issueAuthorityId: row.issue_authority_id,
    grantorSessionKey: row.grantor_session_key,
    granteeSessionKey: row.grantee_session_key,
    transactionRunId: row.transaction_run_id,
    maxUses: 1,
    maxDescendants: 1,
    maxDepthFromP0: 2,
    retryAllowed: false,
    fallbackAllowed: false,
    furtherDelegationAllowed: false,
    consumed: sqliteBool(row.consumed) === true,
    ...(row.reserved_child_session_key
      ? { reservedChildSessionKey: row.reserved_child_session_key }
      : {}),
    ...(row.reserved_run_id ? { reservedRunId: row.reserved_run_id } : {}),
    ...(row.consumed_at != null ? { consumedAt: row.consumed_at } : {}),
    ...(row.consumption_error ? { consumptionError: row.consumption_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type SoraIntegrationObjectRecord = {
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
  classification: "ACCEPTED" | "REJECTED" | "PENDING";
  integrationStatus: "TRANSPORT_RECEIVED" | "CLASSIFIED" | "INTEGRATED" | "REJECTED";
  parentResultChanged: boolean;
  parentResultChangeSummary?: string;
  canonicalized: boolean;
  canonicalizedAt?: number;
  provenanceJson: string;
  createdAt: number;
  updatedAt: number;
};

export function integrationRowToRecord(
  row: SoraIntegrationObjectRow,
): SoraIntegrationObjectRecord | undefined {
  const kind = row.kind === "P0_C1" || row.kind === "C1_G1" ? row.kind : undefined;
  const classification =
    row.classification === "ACCEPTED" ||
    row.classification === "REJECTED" ||
    row.classification === "PENDING"
      ? row.classification
      : undefined;
  const integrationStatus =
    row.integration_status === "TRANSPORT_RECEIVED" ||
    row.integration_status === "CLASSIFIED" ||
    row.integration_status === "INTEGRATED" ||
    row.integration_status === "REJECTED"
      ? row.integration_status
      : undefined;
  if (!kind || !classification || !integrationStatus) {
    return undefined;
  }
  return {
    integrationId: row.integration_id,
    delegationId: row.delegation_id,
    authorityId: row.authority_id,
    kind,
    childResultSessionKey: row.child_result_session_key,
    childResultRunId: row.child_result_run_id,
    originatingTransactionRunId: row.originating_transaction_run_id,
    parentSessionKey: row.parent_session_key,
    ...(row.parent_transaction_run_id
      ? { parentTransactionRunId: row.parent_transaction_run_id }
      : {}),
    resultDigest: row.result_digest,
    classification,
    integrationStatus,
    parentResultChanged: sqliteBool(row.parent_result_changed) === true,
    ...(row.parent_result_change_summary
      ? { parentResultChangeSummary: row.parent_result_change_summary }
      : {}),
    canonicalized: sqliteBool(row.canonicalized) === true,
    ...(row.canonicalized_at != null ? { canonicalizedAt: row.canonicalized_at } : {}),
    provenanceJson: row.provenance_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function boolToSqlite(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0;
}

function sqliteBool(value: number | null): boolean | undefined {
  return value == null ? undefined : value !== 0;
}

export type SoraCanonicalizationGrantRecord = {
  grantId: string;
  integrationId: string;
  delegationId: string;
  authorityId: string;
  /** Tree root the governing edge belongs to; makes grants tree-attributable. */
  rootDelegationId: string;
  /** Live edge binding that must match when the grant is consumed. */
  parentSessionKey: string;
  parentTransactionRunId: string;
  resultDigest: string;
  /** Only an edge currently marked as revoked is a valid revocation target. */
  revokesEdgeDelegationId?: string;
  used: boolean;
  revoked: boolean;
  usedAt?: number;
  revokedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export function canonicalizationGrantRowToRecord(
  row: SoraCanonicalizationGrantRow,
): SoraCanonicalizationGrantRecord | undefined {
  if (
    !row.grant_id ||
    !row.integration_id ||
    !row.delegation_id ||
    !row.authority_id ||
    !row.root_delegation_id ||
    !row.parent_session_key ||
    !row.parent_transaction_run_id ||
    !row.result_digest
  ) {
    return undefined;
  }
  return {
    grantId: row.grant_id,
    integrationId: row.integration_id,
    delegationId: row.delegation_id,
    authorityId: row.authority_id,
    rootDelegationId: row.root_delegation_id,
    parentSessionKey: row.parent_session_key,
    parentTransactionRunId: row.parent_transaction_run_id,
    resultDigest: row.result_digest,
    ...(row.revokes_edge_delegation_id
      ? { revokesEdgeDelegationId: row.revokes_edge_delegation_id }
      : {}),
    used: sqliteBool(row.used) === true,
    revoked: sqliteBool(row.revoked) === true,
    ...(row.used_at != null ? { usedAt: row.used_at } : {}),
    ...(row.revoked_at != null ? { revokedAt: row.revoked_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function canonicalizationGrantRecordToDbValues(record: SoraCanonicalizationGrantRecord): {
  grant_id: string;
  integration_id: string;
  delegation_id: string;
  authority_id: string;
  root_delegation_id: string;
  parent_session_key: string;
  parent_transaction_run_id: string;
  result_digest: string;
  revokes_edge_delegation_id: string | null;
  used: number;
  revoked: number;
  used_at: number | null;
  revoked_at: number | null;
  created_at: number;
  updated_at: number;
} {
  return {
    grant_id: record.grantId,
    integration_id: record.integrationId,
    delegation_id: record.delegationId,
    authority_id: record.authorityId,
    root_delegation_id: record.rootDelegationId,
    parent_session_key: record.parentSessionKey,
    parent_transaction_run_id: record.parentTransactionRunId,
    result_digest: record.resultDigest,
    revokes_edge_delegation_id: record.revokesEdgeDelegationId ?? null,
    used: record.used ? 1 : 0,
    revoked: record.revoked ? 1 : 0,
    used_at: record.usedAt ?? null,
    revoked_at: record.revokedAt ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function capabilityRecordToDbValues(record: SoraC1G1CapabilityRecord): {
  capability_id: string;
  delegation_id: string;
  authority_id: string;
  issue_delegation_id: string;
  issue_authority_id: string;
  grantor_session_key: string;
  grantee_session_key: string;
  transaction_run_id: string;
  max_uses: 1;
  max_descendants: 1;
  max_depth_from_p0: 2;
  retry_allowed: 0;
  fallback_allowed: 0;
  further_delegation_allowed: 0;
  consumed: number | null;
  reserved_child_session_key: string | null;
  reserved_run_id: string | null;
  consumed_at: number | null;
  consumption_error: string | null;
  created_at: number;
  updated_at: number;
} {
  return {
    capability_id: record.capabilityId,
    delegation_id: record.delegationId,
    authority_id: record.authorityId,
    issue_delegation_id: record.issueDelegationId,
    issue_authority_id: record.issueAuthorityId,
    grantor_session_key: record.grantorSessionKey,
    grantee_session_key: record.granteeSessionKey,
    transaction_run_id: record.transactionRunId,
    max_uses: 1,
    max_descendants: 1,
    max_depth_from_p0: 2,
    retry_allowed: 0,
    fallback_allowed: 0,
    further_delegation_allowed: 0,
    consumed: boolToSqlite(record.consumed),
    reserved_child_session_key: record.reservedChildSessionKey ?? null,
    reserved_run_id: record.reservedRunId ?? null,
    consumed_at: record.consumedAt ?? null,
    consumption_error: record.consumptionError ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function integrationToDbValues(record: SoraIntegrationObjectRecord): {
  integration_id: string;
  delegation_id: string;
  authority_id: string;
  kind: DelegationEdgeKind;
  child_result_session_key: string;
  child_result_run_id: string;
  originating_transaction_run_id: string;
  parent_session_key: string;
  parent_transaction_run_id: string | null;
  result_digest: string;
  classification: "ACCEPTED" | "REJECTED" | "PENDING";
  integration_status: "TRANSPORT_RECEIVED" | "CLASSIFIED" | "INTEGRATED" | "REJECTED";
  parent_result_changed: number;
  parent_result_change_summary: string | null;
  canonicalized: number;
  canonicalized_at: number | null;
  provenance_json: string;
  created_at: number;
  updated_at: number;
} {
  return {
    integration_id: record.integrationId,
    delegation_id: record.delegationId,
    authority_id: record.authorityId,
    kind: record.kind,
    child_result_session_key: record.childResultSessionKey,
    child_result_run_id: record.childResultRunId,
    originating_transaction_run_id: record.originatingTransactionRunId,
    parent_session_key: record.parentSessionKey,
    parent_transaction_run_id: record.parentTransactionRunId ?? null,
    result_digest: record.resultDigest,
    classification: record.classification,
    integration_status: record.integrationStatus,
    parent_result_changed: record.parentResultChanged ? 1 : 0,
    parent_result_change_summary: record.parentResultChangeSummary ?? null,
    canonicalized: record.canonicalized ? 1 : 0,
    canonicalized_at: record.canonicalizedAt ?? null,
    provenance_json: record.provenanceJson,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sora_delegation_edges (
  delegation_id TEXT NOT NULL PRIMARY KEY,
  authority_id TEXT NOT NULL UNIQUE,
  parent_delegation_id TEXT,
  root_delegation_id TEXT,
  grantor_session_key TEXT NOT NULL,
  grantee_session_key TEXT NOT NULL,
  grantor_transaction_run_id TEXT NOT NULL,
  grantee_transaction_run_id TEXT,
  edge_kind TEXT NOT NULL CHECK (edge_kind IN ('P0_C1', 'C1_G1')),
  depth INTEGER NOT NULL CHECK (depth >= 0),
  authority_json TEXT NOT NULL,
  retry_allowed INTEGER NOT NULL DEFAULT 0 CHECK (retry_allowed IN (0, 1)),
  fallback_allowed INTEGER NOT NULL DEFAULT 0 CHECK (fallback_allowed IN (0, 1)),
  further_delegation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (further_delegation_allowed IN (0, 1)),
  revocation_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sora_delegation_edges_grantee
  ON sora_delegation_edges(grantee_session_key, delegation_id);

CREATE TABLE IF NOT EXISTS sora_c1_g1_capabilities (
  capability_id TEXT NOT NULL PRIMARY KEY,
  delegation_id TEXT NOT NULL UNIQUE,
  authority_id TEXT NOT NULL UNIQUE,
  issue_delegation_id TEXT NOT NULL,
  issue_authority_id TEXT NOT NULL,
  grantor_session_key TEXT NOT NULL,
  grantee_session_key TEXT NOT NULL,
  transaction_run_id TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses = 1),
  max_descendants INTEGER NOT NULL DEFAULT 1 CHECK (max_descendants = 1),
  max_depth_from_p0 INTEGER NOT NULL DEFAULT 2 CHECK (max_depth_from_p0 = 2),
  retry_allowed INTEGER NOT NULL DEFAULT 0 CHECK (retry_allowed IN (0, 1)),
  fallback_allowed INTEGER NOT NULL DEFAULT 0 CHECK (fallback_allowed IN (0, 1)),
  further_delegation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (further_delegation_allowed IN (0, 1)),
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1)),
  reserved_child_session_key TEXT,
  reserved_run_id TEXT,
  consumed_at INTEGER,
  consumption_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sora_capabilities_grantee
  ON sora_c1_g1_capabilities(grantee_session_key, consumed, delegation_id);

CREATE TABLE IF NOT EXISTS sora_integration_objects (
  integration_id TEXT NOT NULL PRIMARY KEY,
  delegation_id TEXT NOT NULL UNIQUE,
  authority_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('C1_G1', 'P0_C1')),
  child_result_session_key TEXT NOT NULL,
  child_result_run_id TEXT NOT NULL,
  originating_transaction_run_id TEXT NOT NULL,
  parent_session_key TEXT NOT NULL,
  parent_transaction_run_id TEXT,
  result_digest TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('ACCEPTED', 'REJECTED', 'PENDING')),
  integration_status TEXT NOT NULL CHECK (integration_status IN ('TRANSPORT_RECEIVED', 'CLASSIFIED', 'INTEGRATED', 'REJECTED')),
  parent_result_changed INTEGER NOT NULL DEFAULT 0 CHECK (parent_result_changed IN (0, 1)),
  parent_result_change_summary TEXT,
  canonicalized INTEGER NOT NULL DEFAULT 0 CHECK (canonicalized IN (0, 1)),
  canonicalized_at INTEGER,
  provenance_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sora_integration_objects_child
  ON sora_integration_objects(child_result_session_key, kind, classification, integration_id);

CREATE TABLE IF NOT EXISTS sora_canonicalization_grants (
  grant_id TEXT NOT NULL PRIMARY KEY,
  integration_id TEXT NOT NULL UNIQUE,
  delegation_id TEXT NOT NULL,
  authority_id TEXT NOT NULL UNIQUE,
  root_delegation_id TEXT NOT NULL,
  parent_session_key TEXT NOT NULL,
  parent_transaction_run_id TEXT NOT NULL,
  result_digest TEXT NOT NULL,
  revokes_edge_delegation_id TEXT,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1)),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sora_canonicalization_grants_edge
  ON sora_canonicalization_grants(delegation_id, used, revoked);

CREATE TABLE IF NOT EXISTS governed_transaction_runs (
  transaction_id TEXT NOT NULL PRIMARY KEY,
  parent_transaction_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('PARENT', 'CHILD')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'FAILED', 'ABORTED', 'CLOSED')),
  lifecycle_generation TEXT NOT NULL,
  authoritative_session_key TEXT NOT NULL,
  authoritative_run_id TEXT NOT NULL,
  grant_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_governed_transaction_runs_parent
  ON governed_transaction_runs(parent_transaction_id, status);

CREATE TABLE IF NOT EXISTS authoritative_caller_bindings (
  binding_id TEXT NOT NULL PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  session_key TEXT NOT NULL,
  run_id TEXT NOT NULL,
  lifecycle_generation TEXT NOT NULL,
  handle_claim TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_authoritative_caller_bindings_session
  ON authoritative_caller_bindings(session_key, run_id);

CREATE TABLE IF NOT EXISTS governed_subdelegation_grants (
  grant_id TEXT NOT NULL PRIMARY KEY,
  delegation_id TEXT NOT NULL UNIQUE,
  authority_id TEXT NOT NULL UNIQUE,
  capability_id TEXT NOT NULL UNIQUE,
  parent_transaction_run_id TEXT NOT NULL,
  grantor_session_key TEXT NOT NULL,
  grantee_session_key TEXT NOT NULL,
  holder_session_key TEXT NOT NULL,
  parent_edge_delegation_id TEXT NOT NULL,
  lifecycle_generation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED')),
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses = 1),
  max_descendants INTEGER NOT NULL DEFAULT 1 CHECK (max_descendants = 1),
  max_depth_from_p0 INTEGER NOT NULL DEFAULT 2 CHECK (max_depth_from_p0 = 2),
  retry_allowed INTEGER NOT NULL DEFAULT 0 CHECK (retry_allowed IN (0, 1)),
  fallback_allowed INTEGER NOT NULL DEFAULT 0 CHECK (fallback_allowed IN (0, 1)),
  further_delegation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (further_delegation_allowed IN (0, 1)),
  provenance_json TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_governed_subdelegation_grants_grantee
  ON governed_subdelegation_grants(grantee_session_key, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_governed_subdelegation_grants_issuance_scope
  ON governed_subdelegation_grants(parent_transaction_run_id, grantor_session_key, grantee_session_key)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS sora_edge_readiness (
  readiness_id TEXT NOT NULL PRIMARY KEY,
  grant_id TEXT NOT NULL UNIQUE,
  delegation_id TEXT NOT NULL UNIQUE,
  authority_id TEXT NOT NULL UNIQUE,
  lifecycle_generation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('READY', 'REVOKED', 'CLOSED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sora_edge_readiness_grant
  ON sora_edge_readiness(grant_id, status);
`;

const ensuredDatabases = new WeakSet<DatabaseSync>();

/** One-time feature-local lazy ensure; additive tables only, never versioned DDL. */
export function ensureSoraMinimalTreeSchema(options: OpenClawStateDatabaseOptions = {}): void {
  const database = openOpenClawStateDatabase(options);
  if (ensuredDatabases.has(database.db)) {
    return;
  }
  runOpenClawStateWriteTransaction(
    ({ db }) => {
      // sqlite-allow-raw -- Feature-local additive schema DDL; rows use Kysely.
      db.exec(SCHEMA_SQL);
    },
    options,
    { operationLabel: "sora-minimal-tree.schema.ensure" },
  );
  ensuredDatabases.add(database.db);
}

export function openSoraMinimalTreeStore(options: OpenClawStateDatabaseOptions = {}) {
  ensureSoraMinimalTreeSchema(options);
  const database = openOpenClawStateDatabase(options);
  return {
    database,
    kysely: getNodeSqliteKysely<SoraMinimalTreeDatabase>(database.db),
  };
}
