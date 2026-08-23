/**
 * One-shot C1→G1 subdelegation (T3).
 *
 * The C1_G1_SUBDELEGATION_CAPABILITY carries max_uses=1, max_descendants=1,
 * max_depth_from_P0=2, retry/fallback/further-delegation all prohibited.
 * Consumption is a single atomic write: a guarded UPDATE that flips
 * consumed=0→1 with the exact reservation, so concurrent/racing requests can
 * never both obtain G1 execution. A failed, ambiguous, partial, or racing
 * consumption never permits G1 execution, and no second C1→G1 use is possible.
 */
import { executeSqliteQuerySync } from "../../infra/kysely-sync.js";
import type { OpenClawStateDatabaseOptions } from "../../state/openclaw-state-db.js";
import { runOpenClawStateWriteTransaction } from "../../state/openclaw-state-db.js";
import {
  capabilityRowToRecord,
  openSoraMinimalTreeStore,
  type SoraC1G1CapabilityRecord,
} from "./store.js";

export type SoraGateOneShotAdmission = {
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
  reservedChildSessionKey?: string;
  reservedRunId?: string;
};

export type SoraConsumeFailureCode =
  | "CAPABILITY_NOT_FOUND"
  | "CAPABILITY_ALREADY_CONSUMED"
  | "CAPABILITY_NOT_ISSUED_BY_C1_EDGE"
  | "CAPABILITY_BOUNDS_VIOLATION"
  | "RACE_RESERVATION_CONFLICT"
  | "UNRESOLVED_STATE";

export type ConsumeSoraC1G1Result =
  | { ok: true; admission: SoraGateOneShotAdmission }
  | { ok: false; reason: SoraConsumeFailureCode; detail?: string };

function capabilityRecordToAdmission(record: SoraC1G1CapabilityRecord): SoraGateOneShotAdmission {
  return {
    capabilityId: record.capabilityId,
    delegationId: record.delegationId,
    authorityId: record.authorityId,
    issueDelegationId: record.issueDelegationId,
    issueAuthorityId: record.issueAuthorityId,
    grantorSessionKey: record.grantorSessionKey,
    granteeSessionKey: record.granteeSessionKey,
    transactionRunId: record.transactionRunId,
    maxUses: 1,
    maxDescendants: 1,
    maxDepthFromP0: 2,
    retryAllowed: false,
    fallbackAllowed: false,
    furtherDelegationAllowed: false,
    ...(record.reservedChildSessionKey
      ? { reservedChildSessionKey: record.reservedChildSessionKey }
      : {}),
    ...(record.reservedRunId ? { reservedRunId: record.reservedRunId } : {}),
  };
}

export function createSoraC1G1CapabilityRecord(params: {
  capabilityId: string;
  delegationId: string;
  authorityId: string;
  issueDelegationId: string;
  issueAuthorityId: string;
  grantorSessionKey: string;
  granteeSessionKey: string;
  transactionRunId: string;
  now: number;
}): SoraC1G1CapabilityRecord {
  return {
    capabilityId: params.capabilityId,
    delegationId: params.delegationId,
    authorityId: params.authorityId,
    issueDelegationId: params.issueDelegationId,
    issueAuthorityId: params.issueAuthorityId,
    grantorSessionKey: params.grantorSessionKey,
    granteeSessionKey: params.granteeSessionKey,
    transactionRunId: params.transactionRunId,
    maxUses: 1,
    maxDescendants: 1,
    maxDepthFromP0: 2,
    retryAllowed: false,
    fallbackAllowed: false,
    furtherDelegationAllowed: false,
    consumed: false,
    createdAt: params.now,
    updatedAt: params.now,
  };
}

/**
 * Read-only capability lookup for pre-gate checks (validating before consumption).
 */
export function readSoraC1G1Capability(
  capabilityId: string,
  options: OpenClawStateDatabaseOptions = {},
): SoraC1G1CapabilityRecord | undefined {
  const { database } = openSoraMinimalTreeStore(options);
  const row = database.db
    .prepare("SELECT * FROM sora_c1_g1_capabilities WHERE capability_id = ?")
    .get(capabilityId) as Record<string, unknown> | undefined;
  return row ? capabilityRowToRecord(row as never) : undefined;
}

/** Loads the capability row by its C1_G1 delegation id (the edge that issued it). */
export function readSoraC1G1CapabilityByDelegation(
  delegationId: string,
  options: OpenClawStateDatabaseOptions = {},
): SoraC1G1CapabilityRecord | undefined {
  const { database } = openSoraMinimalTreeStore(options);
  const row = database.db
    .prepare("SELECT * FROM sora_c1_g1_capabilities WHERE delegation_id = ?")
    .get(delegationId) as Record<string, unknown> | undefined;
  return row ? capabilityRowToRecord(row as never) : undefined;
}

/**
 * Atomically consumes the single-use C1→G1 capability and reserves the exact
 * G1 child session + run inside one transaction. Racing requests fail at the
 * guarded UPDATE (affected rows = 0) and can never both reserve G1.
 */
export function consumeSoraC1G1Capability(
  params: {
    capabilityId: string;
    grantorSessionKey: string;
    transactionRunId: string;
    childSessionKey: string;
    childRunId: string;
    now: number;
  },
  options: OpenClawStateDatabaseOptions = {},
): ConsumeSoraC1G1Result {
  if (
    !params.capabilityId.trim() ||
    !params.grantorSessionKey.trim() ||
    !params.childSessionKey.trim() ||
    !params.childRunId.trim()
  ) {
    return { ok: false, reason: "UNRESOLVED_STATE", detail: "missing required identities" };
  }
  let admission: SoraGateOneShotAdmission | undefined;
  try {
    runOpenClawStateWriteTransaction(
      ({ db }) => {
        const row = db
          .prepare("SELECT * FROM sora_c1_g1_capabilities WHERE capability_id = ?")
          .get(params.capabilityId) as Record<string, unknown> | undefined;
        const record = row ? capabilityRowToRecord(row as never) : undefined;
        if (!record) {
          throw Object.assign(new Error("capability row not found"), {
            soraCode: "CAPABILITY_NOT_FOUND",
          });
        }
        if (record.consumed) {
          throw Object.assign(new Error("capability already consumed"), {
            soraCode: "CAPABILITY_ALREADY_CONSUMED",
          });
        }
        if (
          record.grantorSessionKey !== params.grantorSessionKey ||
          record.transactionRunId !== params.transactionRunId
        ) {
          throw Object.assign(new Error("capability was not issued by this C1 edge"), {
            soraCode: "CAPABILITY_NOT_ISSUED_BY_C1_EDGE",
          });
        }
        if (
          record.maxUses !== 1 ||
          record.maxDescendants !== 1 ||
          record.maxDepthFromP0 !== 2 ||
          record.retryAllowed ||
          record.fallbackAllowed ||
          record.furtherDelegationAllowed
        ) {
          throw Object.assign(new Error("capability bounds are not the bounded one-shot shape"), {
            soraCode: "CAPABILITY_BOUNDS_VIOLATION",
          });
        }
        const claimed = db
          .prepare(
            `UPDATE sora_c1_g1_capabilities
             SET consumed = 1,
                 reserved_child_session_key = ?,
                 reserved_run_id = ?,
                 consumed_at = ?,
                 updated_at = ?
             WHERE capability_id = ? AND consumed = 0`,
          )
          .run(
            params.childSessionKey,
            params.childRunId,
            params.now,
            params.now,
            params.capabilityId,
          );
        if (claimed.changes !== 1) {
          throw Object.assign(new Error("racing request claimed this capability first"), {
            soraCode: "RACE_RESERVATION_CONFLICT",
          });
        }
        admission = capabilityRecordToAdmission({
          ...record,
          consumed: true,
          reservedChildSessionKey: params.childSessionKey,
          reservedRunId: params.childRunId,
          consumedAt: params.now,
          updatedAt: params.now,
        });
      },
      options,
      { operationLabel: "sora-c1g1.capability.consume" },
    );
  } catch (err) {
    const soraCode =
      err instanceof Error && "soraCode" in err
        ? (err as unknown as { soraCode?: string }).soraCode
        : undefined;
    if (soraCode) {
      return {
        ok: false,
        reason: soraCode as SoraConsumeFailureCode,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    return { ok: false, reason: "UNRESOLVED_STATE", detail: String(err) };
  }
  return admission
    ? { ok: true, admission }
    : {
        ok: false,
        reason: "UNRESOLVED_STATE",
        detail: "transaction completed without reservation",
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
  consumed: number;
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
    consumed: record.consumed ? 1 : 0,
    reserved_child_session_key: record.reservedChildSessionKey ?? null,
    reserved_run_id: record.reservedRunId ?? null,
    consumed_at: record.consumedAt ?? null,
    consumption_error: record.consumptionError ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function insertSoraC1G1Capability(
  record: SoraC1G1CapabilityRecord,
  options: OpenClawStateDatabaseOptions = {},
): { ok: true } | { ok: false; reason: string } {
  const { database, kysely } = openSoraMinimalTreeStore(options);
  try {
    executeSqliteQuerySync(
      database.db,
      kysely.insertInto("sora_c1_g1_capabilities").values(capabilityRecordToDbValues(record)),
    );
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}
