/**
 * C1→G1 spawn-side admission gate (T3 wiring).
 *
 * Pure fail-closed evaluation consumed by `resolveSpawnAdmission` when a
 * bounded subdelegation envelope is present. Implements the required semantic
 * ordering: capability exists → fresh edge identity → authority ceiling →
 * depth/count/route/readiness → atomic capability consume + exact G1
 * reservation. Only after consumption returns ok does descendant execution
 * become eligible. retryAllowed=false/fallbackAllowed=false mean terminal
 * failure: the gate surfaces a terminal forbidden/error result and never
 * yields a second execution through recovery, retry, or fallback machinery.
 */
import type { OpenClawStateDatabaseOptions } from "../../state/openclaw-state-db.js";
import { loadSoraDelegationEdge } from "./delegation-edge.js";
import {
  readSoraC1G1Capability,
  readSoraC1G1CapabilityByDelegation,
} from "./one-shot-subdelegation.js";
import { SORA_C1_G1_MAX_DEPTH_FROM_P0 } from "./store.js";

export type SoraSpawnGateFailure = {
  code:
    | "SORA_CAPABILITY_MISSING"
    | "SORA_CAPABILITY_UNKNOWN"
    | "SORA_EDGE_MISMATCH"
    | "SORA_CAPABILITY_CONSUMED"
    | "SORA_AUTHORITY_VIOLATION"
    | "SORA_DEPTH_VIOLATION"
    | "SORA_COUNT_VIOLATION"
    | "SORA_RETRY_FALLBACK_FORBIDDEN"
    | "SORA_ROUTE_VIOLATION"
    | "SORA_READINESS_UNAVAILABLE";
  message: string;
};

export type SoraSpawnGateParams = {
  capabilityId?: string;
  delegationId?: string;
  requesterSessionKey: string;
  requesterTransactionRunId: string;
  callerDepth: number;
  activeChildren: number;
  maxActiveChildren: number;
  options?: OpenClawStateDatabaseOptions;
};

export type SoraSpawnGateResult =
  | { ok: true; delegationId: string; authorityId: string; capabilityId: string }
  | { ok: false; failure: SoraSpawnGateFailure };

/**
 * Validates a bounded C1→G1 subdelegation request before any session/run
 * reservation occurs. The capability row itself is the machine-comparable
 * authorization: P0→C1 readiness can never be reused as C1→G1 readiness.
 */
export function resolveSoraC1G1SpawnGate(params: SoraSpawnGateParams): SoraSpawnGateResult {
  const capabilityId = params.capabilityId?.trim();
  const delegationId = params.delegationId?.trim();
  if (!capabilityId || !delegationId) {
    return {
      ok: false,
      failure: {
        code: "SORA_CAPABILITY_MISSING",
        message: "sora capability/delegation identity missing",
      },
    };
  }

  const capability = readSoraC1G1Capability(capabilityId, params.options);
  const byDelegation = readSoraC1G1CapabilityByDelegation(delegationId, params.options);
  if (!capability || !byDelegation || capability.capabilityId !== byDelegation.capabilityId) {
    return {
      ok: false,
      failure: {
        code: "SORA_CAPABILITY_MISSING",
        message: "capability row or delegation binding not found",
      },
    };
  }
  if (capability.delegationId !== delegationId) {
    return {
      ok: false,
      failure: {
        code: "SORA_CAPABILITY_MISSING",
        message: "capability/delegation identity mismatch",
      },
    };
  }

  const c1Edge = loadSoraDelegationEdge(capability.issueDelegationId, params.options);
  if (!c1Edge || c1Edge.edgeKind !== "P0_C1") {
    return {
      ok: false,
      failure: { code: "SORA_EDGE_MISMATCH", message: "issuing C1 edge not found" },
    };
  }
  if (
    c1Edge.granteeSessionKey !== params.requesterSessionKey ||
    capability.transactionRunId !== params.requesterTransactionRunId
  ) {
    return {
      ok: false,
      failure: {
        code: "SORA_EDGE_MISMATCH",
        message: "C1 requester identity does not own this capability",
      },
    };
  }

  if (capability.consumed) {
    return {
      ok: false,
      failure: {
        code: "SORA_CAPABILITY_CONSUMED",
        message: "C1→G1 capability is already consumed",
      },
    };
  }
  if (capability.grantorSessionKey !== params.requesterSessionKey) {
    return {
      ok: false,
      failure: {
        code: "SORA_EDGE_MISMATCH",
        message: "capability grantor does not match requester",
      },
    };
  }

  if (params.callerDepth + 1 > SORA_C1_G1_MAX_DEPTH_FROM_P0) {
    return {
      ok: false,
      failure: {
        code: "SORA_DEPTH_VIOLATION",
        message: "C1→G1 depth exceeds the minimal-tree bound",
      },
    };
  }
  if (params.maxActiveChildren > 0 && params.activeChildren + 1 > params.maxActiveChildren) {
    return {
      ok: false,
      failure: {
        code: "SORA_COUNT_VIOLATION",
        message: "descendant count exceeds the minimal-tree bound",
      },
    };
  }
  if (
    capability.retryAllowed ||
    capability.fallbackAllowed ||
    capability.furtherDelegationAllowed
  ) {
    return {
      ok: false,
      failure: {
        code: "SORA_RETRY_FALLBACK_FORBIDDEN",
        message: "retry/fallback/further delegation are forbidden on this route",
      },
    };
  }

  const authority = c1Edge.authority;
  if (authority.routeId !== "sora-minimal-tree-v1" || !authority.delegableCeiling) {
    return {
      ok: false,
      failure: {
        code: "SORA_AUTHORITY_VIOLATION",
        message: "C1 authority is not a delegable minimal-tree ceiling",
      },
    };
  }
  if (
    !authority.executorKind.includes("openclaw-subagent") ||
    !authority.runtimeRoute.includes("embedded-subagent")
  ) {
    return {
      ok: false,
      failure: {
        code: "SORA_ROUTE_VIOLATION",
        message: "executor/runtime route not within the delegable ceiling",
      },
    };
  }

  return {
    ok: true,
    delegationId,
    authorityId: capability.authorityId,
    capabilityId: capability.capabilityId,
  };
}
