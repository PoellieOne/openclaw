/**
 * Bounded delegation edge identity (T1) and per-delegation authority ceiling
 * (T2) for the minimal P0→C1→G1 route.
 *
 * Every edge carries its own delegation id and authority id; nothing is
 * inherited across edges. A C1 child transaction becoming a bounded parent for
 * one G1 transaction always uses a freshly minted edge and authority identity
 * (P0_C1_DELEGATION_ID != C1_G1_DELEGATION_ID). Spawn capability never implies
 * authority: the ceiling is compared field-by-field and fails closed on any
 * unknown, malformed, or missing dimension.
 */
import crypto from "node:crypto";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
} from "../../infra/kysely-sync.js";
import type { OpenClawStateDatabaseOptions } from "../../state/openclaw-state-db.js";
import { stableStringify } from "../stable-stringify.js";
import {
  authorityToDbJson,
  compareSoraAuthority,
  edgeRowToRecord,
  openSoraMinimalTreeStore,
  SORA_C1_G1_MAX_DEPTH_FROM_P0,
  SORA_C1_MAX_DESCENDANTS,
  SORA_G1_MAX_DESCENDANTS,
  SORA_MINIMAL_TREE_ROUTE_ID,
  SORA_P0_C1_MAX_DEPTH,
  type DelegationEdgeKind,
  type SoraDelegationAuthority,
  type SoraDelegationEdgeRecord,
} from "./store.js";

function mintSoraId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function mintSoraDelegationId(edgeKind: DelegationEdgeKind): string {
  return mintSoraId(edgeKind === "P0_C1" ? "P0_C1_DELEGATION" : "C1_G1_DELEGATION");
}

export function mintSoraAuthorityId(): string {
  return mintSoraId("AUTH");
}

export type ResolveSoraAuthorityResult =
  | { ok: true; authority: SoraDelegationAuthority }
  | { ok: false; reason: string };

function finishAuthority(params: {
  routeId: string;
  depth: number;
  maxDescendants: number;
  permittedToolNames: readonly string[];
  mutationNames: readonly string[];
  scope: readonly string[];
  executorKind: readonly string[];
  runtimeRoute: readonly string[];
  delegableCeiling: boolean;
  token?: string;
}): ResolveSoraAuthorityResult {
  return {
    ok: true,
    authority: {
      routeId: params.routeId,
      depth: params.depth,
      maxDescendants: params.maxDescendants,
      permittedToolNames: [...params.permittedToolNames],
      mutationNames: [...params.mutationNames],
      scope: [...params.scope],
      executorKind: [...params.executorKind],
      runtimeRoute: [...params.runtimeRoute],
      delegableCeiling: params.delegableCeiling,
      ...(params.token ? { token: params.token } : {}),
    },
  };
}

const MINIMAL_TREE_TOOLS: readonly string[] = ["subagents_sessions_spawn"];
const MINIMAL_TREE_MUTATIONS: readonly string[] = [];
const MINIMAL_TREE_SCOPE: readonly string[] = ["single-child", "single-grandchild"];
const MINIMAL_TREE_G1_SCOPE: readonly string[] = ["single-child"];
const MINIMAL_TREE_EXECUTORS: readonly string[] = ["openclaw-subagent"];
const MINIMAL_TREE_ROUTES: readonly string[] = ["embedded-subagent"];

/**
 * Resolves the C1 authority ceiling derived from a P0→C1 delegation edge.
 * Anything outside the bounded route fails closed.
 */
export function resolveC1DelegationAuthority(params: {
  delegationId: string;
  grantorSessionKey: string;
  granteeSessionKey: string;
  grantorTransactionRunId: string;
}): ResolveSoraAuthorityResult {
  if (
    !params.delegationId.trim() ||
    !params.grantorSessionKey.trim() ||
    !params.granteeSessionKey.trim()
  ) {
    return {
      ok: false,
      reason: "P0_C1 delegation requires non-empty delegation, grantor, and grantee identities",
    };
  }
  return finishAuthority({
    routeId: SORA_MINIMAL_TREE_ROUTE_ID,
    depth: SORA_P0_C1_MAX_DEPTH,
    maxDescendants: SORA_C1_MAX_DESCENDANTS,
    permittedToolNames: MINIMAL_TREE_TOOLS,
    mutationNames: MINIMAL_TREE_MUTATIONS,
    scope: MINIMAL_TREE_SCOPE,
    executorKind: MINIMAL_TREE_EXECUTORS,
    runtimeRoute: MINIMAL_TREE_ROUTES,
    delegableCeiling: true,
    token: stableStringify([
      params.delegationId,
      params.grantorSessionKey,
      params.granteeSessionKey,
      params.grantorTransactionRunId,
    ]),
  });
}

/**
 * Resolves the fresh G1 authority for one C1→G1 subdelegation. The ceiling is
 * the exact C1 authority minted by the P0→C1 edge, never a config default or a
 * tool-availability snapshot.
 */
export function resolveG1DelegationAuthority(params: {
  granteeSessionKey: string;
  grantorTransactionRunId: string;
  ceiling: SoraDelegationAuthority;
}): ResolveSoraAuthorityResult {
  const candidate = finishAuthority({
    routeId: SORA_MINIMAL_TREE_ROUTE_ID,
    depth: SORA_C1_G1_MAX_DEPTH_FROM_P0,
    maxDescendants: SORA_G1_MAX_DESCENDANTS,
    permittedToolNames: [],
    mutationNames: [],
    // G1 executes exactly one child task: a strict subset of the canonical C1
    // scope (single-child, single-grandchild). `compareSoraAuthority` below
    // fails closed if the ceiling ever shrinks below this scope.
    scope: MINIMAL_TREE_G1_SCOPE,
    executorKind: params.ceiling.executorKind,
    runtimeRoute: params.ceiling.runtimeRoute,
    delegableCeiling: false,
    token: stableStringify([params.granteeSessionKey, params.grantorTransactionRunId]),
  });
  if (!candidate.ok) {
    return candidate;
  }
  const comparison = compareSoraAuthority(params.ceiling, candidate.authority);
  return comparison.ok
    ? candidate
    : { ok: false, reason: `G1 authority ceiling violated: ${comparison.reason}` };
}

export type CreateSoraDelegationEdgeParams = {
  delegationId: string;
  grantorSessionKey: string;
  granteeSessionKey: string;
  grantorTransactionRunId: string;
  granteeTransactionRunId?: string;
  edgeKind: DelegationEdgeKind;
  authority: SoraDelegationAuthority;
  parentDelegationId?: string;
  rootDelegationId: string;
};

/** Inserts one delegation edge row plus its authority identity (durable, unique). */
export function createSoraDelegationEdge(
  params: CreateSoraDelegationEdgeParams,
  options: OpenClawStateDatabaseOptions = {},
): { ok: true; delegationId: string; authorityId: string } | { ok: false; reason: string } {
  if (params.edgeKind === "C1_G1" && params.authority.depth !== SORA_C1_G1_MAX_DEPTH_FROM_P0) {
    return { ok: false, reason: "C1_G1 edges must sit at depth 2" };
  }
  if (params.edgeKind === "P0_C1" && params.authority.depth !== SORA_P0_C1_MAX_DEPTH) {
    return { ok: false, reason: "P0_C1 edges must sit at depth 1" };
  }
  const authorityId = mintSoraAuthorityId();
  const now = Date.now();
  const { database } = openSoraMinimalTreeStore(options);
  try {
    // sqlite-allow-raw -- single guarded insert; PK+UNIQUE enforce edge/authority identity.
    database.db
      .prepare(
        `INSERT INTO sora_delegation_edges (
          delegation_id, authority_id, parent_delegation_id, root_delegation_id,
          grantor_session_key, grantee_session_key, grantor_transaction_run_id,
          grantee_transaction_run_id, edge_kind, depth, authority_json,
          retry_allowed, fallback_allowed, further_delegation_allowed,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
      )
      .run(
        params.delegationId,
        authorityId,
        params.parentDelegationId ?? null,
        params.rootDelegationId,
        params.grantorSessionKey,
        params.granteeSessionKey,
        params.grantorTransactionRunId,
        params.granteeTransactionRunId ?? null,
        params.edgeKind,
        params.authority.depth,
        authorityToDbJson(params.authority),
        now,
        now,
      );
  } catch {
    return { ok: false, reason: "delegation edge already exists" };
  }
  return { ok: true, delegationId: params.delegationId, authorityId };
}

/** Read a delegation edge by exact delegation id. */
export function loadSoraDelegationEdge(
  delegationId: string,
  options: OpenClawStateDatabaseOptions = {},
): SoraDelegationEdgeRecord | undefined {
  const { database, kysely } = openSoraMinimalTreeStore(options);
  const row = executeSqliteQueryTakeFirstSync(
    database.db,
    kysely
      .selectFrom("sora_delegation_edges")
      .selectAll()
      .where("delegation_id", "=", delegationId),
  );
  return row ? edgeRowToRecord(row) : undefined;
}

/** Loads the unique delegation edge whose grantee is the C1 session, if it is exactly one. */
export function loadSoraDelegationEdgeByGrantee(
  granteeSessionKey: string,
  edgeKind: DelegationEdgeKind,
  options: OpenClawStateDatabaseOptions = {},
): SoraDelegationEdgeRecord | undefined {
  const { database, kysely } = openSoraMinimalTreeStore(options);
  const rows = executeSqliteQuerySync(
    database.db,
    kysely
      .selectFrom("sora_delegation_edges")
      .selectAll()
      .where("grantee_session_key", "=", granteeSessionKey)
      .where("edge_kind", "=", edgeKind)
      .orderBy("created_at", "asc"),
  ).rows;
  const candidates = rows
    .map((row) => edgeRowToRecord(row))
    .filter((record) => record !== undefined);
  return candidates.length === 1 ? candidates[0] : undefined;
}
