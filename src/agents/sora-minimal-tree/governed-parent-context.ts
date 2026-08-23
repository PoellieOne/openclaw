/**
 * Governed parent context (Phase B1).
 *
 * `ActiveGovernedParentHandle` is the process-local, non-serializable
 * possession object for a governed parent transition. Its possession
 * semantics are the exact Phase-B1 contract:
 *
 * - privately minted by this module only (`mintRuntimeOwnedGovernedParentHandle`);
 * - validated by private object identity inside the issuance seam
 *   (a WeakSet membership check, not an identifier comparison);
 * - bound to the runtime-owned run identity plus the lifecycle
 *   generation/epoch captured at mint time;
 * - invalidatable on lifecycle termination / generation rotation / explicit
 *   governed closure;
 * - unusable after invalidation (live-registry check at use);
 * - process-local: process death destroys the registry and therefore the
 *   possession (nothing is serialized);
 * - never serializable: no value is exported that could round-trip the
 *   handle through JSON, tool args, RPC, or DB rows.
 *
 * Caller-controlled strings (`runId`, `sessionKey`, `requesterTurnRunId`,
 * `agentId`, transaction IDs) are never sufficient to construct or validate
 * possession: the registry keys are runtime-supplied and the object identity
 * is private. This preserves `IDENTIFIER_KNOWLEDGE != POSSESSION` and
 * `ROW_MATCH != POSSESSION`.
 */
import { randomUUID } from "node:crypto";

const ACTIVE_GOVERNED_PARENT_HANDLE_MARKER = Symbol("openclaw.sora.governedParentHandle");

const handleRegistry = new WeakSet<object>();
const handleIdByObject = new WeakMap<object, string>();

export type GovernedParentHandleStatus = { state: "ACTIVE" } | { state: "INVALIDATED" };

export type ActiveGovernedParentHandle = {
  readonly [ACTIVE_GOVERNED_PARENT_HANDLE_MARKER]: "ActiveGovernedParentHandle";
  readonly handleId: string;
  readonly runId: string;
  readonly sessionKey: string;
  readonly lifecycleGeneration: string;
  /** Millisecond timestamp of the mint; used for ordering diagnostics only. */
  readonly mintedAt: number;
  /** Status query; never usable as a trust input. */
  readonly status: () => GovernedParentHandleStatus;
};

function mintHandleInternal(params: {
  runId: string;
  sessionKey: string;
  lifecycleGeneration: string;
  now: number;
}): ActiveGovernedParentHandle {
  const handle: ActiveGovernedParentHandle = {
    [ACTIVE_GOVERNED_PARENT_HANDLE_MARKER]: "ActiveGovernedParentHandle",
    handleId: randomUUID(),
    runId: params.runId,
    sessionKey: params.sessionKey,
    lifecycleGeneration: params.lifecycleGeneration,
    mintedAt: params.now,
    status: () =>
      isActiveGovernedParentHandle(handle) ? { state: "ACTIVE" } : { state: "INVALIDATED" },
  };
  handleRegistry.add(handle);
  handleIdByObject.set(handle, handle.handleId);
  return handle;
}

/**
 * Private-object-identity validation. `runId`/`sessionKey`/transaction IDs
 * alone can never pass this check: the candidate must be the exact object
 * previously minted and still registered in this process.
 */
export function isActiveGovernedParentHandle(
  candidate: unknown,
): candidate is ActiveGovernedParentHandle {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    (candidate as { [ACTIVE_GOVERNED_PARENT_HANDLE_MARKER]?: unknown })[
      ACTIVE_GOVERNED_PARENT_HANDLE_MARKER
    ] === "ActiveGovernedParentHandle" &&
    handleRegistry.has(candidate)
  );
}

/**
 * The single runner-owned minting seat. Runtime callers call this; it is the
 * only production path to an `ActiveGovernedParentHandle`. It must only be
 * invoked from the runtime-owned attachment seam (agent lifecycle boundary),
 * never from caller-controlled or model-facing input handling.
 */
export function mintRuntimeOwnedGovernedParentHandle(params: {
  runId: string;
  sessionKey: string;
  lifecycleGeneration: string;
  now?: number;
}): ActiveGovernedParentHandle {
  return mintHandleInternal({
    runId: params.runId,
    sessionKey: params.sessionKey,
    lifecycleGeneration: params.lifecycleGeneration,
    now: params.now ?? Date.now(),
  });
}

/**
 * Returns ACTIVE only while the handle is still registered in this process
 * and not invalidated. After `invalidateActiveGovernedParentHandle` or
 * process death, this returns INVALIDATED.
 */
export function governedParentHandleStatus(
  handle: ActiveGovernedParentHandle,
): GovernedParentHandleStatus {
  return isActiveGovernedParentHandle(handle) ? { state: "ACTIVE" } : { state: "INVALIDATED" };
}

/**
 * Explicit lifecycle invalidation. This is the runtime-owned closure hook
 * (normal completion, failure, abort, generation rotation, governed closure).
 * After invalidation the handle object remains a plain object but is no
 * longer live governed possession; every subsequent use fails closed.
 */
export function invalidateActiveGovernedParentHandle(handle: ActiveGovernedParentHandle): void {
  if (isActiveGovernedParentHandle(handle)) {
    handleRegistry.delete(handle);
    handleIdByObject.delete(handle);
  }
}

/**
 * Reads the private handleId for diagnostics/tests only. The value is never
 * exposed on serializable surfaces and never reconstructs possession.
 */
export function readActiveGovernedParentHandleId(handle: ActiveGovernedParentHandle): string {
  return handleIdByObject.get(handle) ?? "";
}
