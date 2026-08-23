/**
 * Governed runtime attachment (Phase B1).
 *
 * The single runtime-owned seam where a governed parent transition begins.
 * This module owns the ONLY production bridge between the runner lifecycle
 * (agent events, lifecycle generation) and the governed parent context.
 *
 * - `mintRuntimeGovernedParentHandleForRun` is invoked from the runtime-owned
 *   attachment point (the embedded attempt runner lifecycle), never from
 *   tool/model args, RPC/HTTP JSON, DirectSpawn inputs, or tools.invoke.
 * - The minted handle is bound to the runner-captured `runId`/`sessionKey`
 *   and to the CURRENT lifecycle generation from the runner-owned registry
 *   (`getAgentEventLifecycleGeneration`); caller-supplied values are never
 *   accepted as identity.
 * - `resolvePossessedGovernedParentForRun` is the INTERNAL possession carry:
 *   it only yields the live handle when the process-local index holds it,
 *   the lifecycle generation is current, AND the call executes inside the
 *   runtime-owned execution context (AsyncLocalStorage) whose generation
 *   matches. External call paths (HTTP/RPC/tool-arg dispatch without runner
 *   ALS context) can never observe the handle through identifiers alone:
 *   `IDENTIFIER_KNOWLEDGE != POSSESSION`.
 * - Lifecycle invalidation is registered with the agent lifecycle event
 *   stream (end/error/finishing per run) and the gateway lifecycle rotation
 *   handler, so normal completion, failure, abort, rotation, and explicit
 *   governed closure all invalidate the process-local handle.
 * - Process death destroys process-local possession inherently (nothing is
 *   serialized); `kill -9` cannot run cleanup, so no cleanup is claimed.
 */
import {
  getAgentEventExecutionLifecycleGeneration,
  getAgentEventLifecycleGeneration,
  onAgentRuntimeEvent,
  registerAgentEventLifecycleRotationHandler,
} from "../../infra/agent-events.js";
import { loadSoraDelegationEdgeByGrantee } from "./delegation-edge.js";
import {
  invalidateActiveGovernedParentHandle,
  isActiveGovernedParentHandle,
  mintRuntimeOwnedGovernedParentHandle,
  type ActiveGovernedParentHandle,
} from "./governed-parent-context.js";

export type GovernedRuntimeAttachmentResult =
  | { ok: true; handle: ActiveGovernedParentHandle }
  | { ok: false; reason: string };

function attachmentFailure(reason: string): GovernedRuntimeAttachmentResult {
  return { ok: false, reason };
}

const liveHandleIndex = new Map<string, ActiveGovernedParentHandle>();

function handleIndexKey(runId: string, sessionKey: string): string {
  return `${runId}::${sessionKey}`;
}

/**
 * The runtime-owned attachment seam. Must only be called from the runner
 * lifecycle boundary (embedded run start). It derives identity from the
 * runner-owned context and the process-local lifecycle registry; any
 * caller-supplied `runId`/`sessionKey` values are treated as
 * `CALLER_INFLUENCED` and never trusted.
 */
export function mintRuntimeGovernedParentHandleForRun(params: {
  runId: string;
  sessionKey: string;
}): GovernedRuntimeAttachmentResult {
  const runId = params.runId?.trim();
  const sessionKey = params.sessionKey?.trim();
  if (!runId || !sessionKey) {
    return attachmentFailure("runId and sessionKey are required at the runtime attachment seam");
  }
  const lifecycleGeneration = getAgentEventLifecycleGeneration();
  const handle = mintRuntimeOwnedGovernedParentHandle({
    runId,
    sessionKey,
    lifecycleGeneration,
  });
  liveHandleIndex.set(handleIndexKey(runId, sessionKey), handle);
  registerHandleLifecycleInvalidation(handle);
  return { ok: true, handle };
}

/**
 * Internal possession carry. Resolves the live runtime-owned handle for the
 * exact run+session pair ONLY when:
 *
 * - the process-local index holds an ACTIVE handle for that pair;
 * - the handle's lifecycle generation matches the CURRENT process lifecycle
 *   generation; and
 * - this call executes inside the runtime-owned execution context
 *   (AsyncLocalStorage) whose generation matches the handle's generation.
 *
 * A caller that knows `runId`/`sessionKey` but is NOT inside the runtime-owned
 * execution (HTTP/RPC/tool-arg dispatch without runner ALS context) can never
 * observe the handle here: the ALS generation check fails closed when the
 * execution context is absent.
 */
export function resolvePossessedGovernedParentForRun(params: {
  runId: string;
  sessionKey: string;
}): ActiveGovernedParentHandle | undefined {
  const runId = params.runId?.trim();
  const sessionKey = params.sessionKey?.trim();
  if (!runId || !sessionKey) {
    return undefined;
  }
  const handle = liveHandleIndex.get(handleIndexKey(runId, sessionKey));
  if (!handle || !isActiveGovernedParentHandle(handle)) {
    return undefined;
  }
  if (handle.lifecycleGeneration !== getAgentEventLifecycleGeneration()) {
    return undefined;
  }
  const executionGeneration = getAgentEventExecutionLifecycleGeneration();
  if (executionGeneration === undefined || executionGeneration !== handle.lifecycleGeneration) {
    return undefined;
  }
  return handle;
}

/**
 * Tool-construction boundary gate (B2 production source seam).
 *
 * Called only from the sessions_spawn tool construction/execution context of
 * the embedded runner. It yields the governed transaction run id for the
 * current requester ONLY when ALL of the following hold:
 *
 * - the requester session is currently possessing a live runtime-owned
 *   governed parent handle for the requester's own run (process-local object
 *   + current lifecycle generation + runner ALS execution context);
 * - the requester has a live, un-revoked P0_C1 delegation edge (the governed
 *   parent role for the minimal tree), so ordinary S21/S22 sessions are
 *   NEVER routed through governed issuance.
 *
 * Nothing here trusts caller-supplied identifiers for authority: identifiers
 * only name the lookup; the authoritative validation (live handle object +
 * ALS generation + parent edge re-read under the same SQLite lock) happens
 * inside the issuance writer. `IDENTIFIER_KNOWLEDGE != POSSESSION` is
 * preserved because the caller cannot obtain the ALS execution context or
 * the live handle from identifiers alone.
 */
export function resolveGovernedSpawnRunIdForRequester(params: {
  requesterRunId?: string;
  requesterSessionKey?: string;
}): string | undefined {
  const runId = params.requesterRunId?.trim();
  const sessionKey = params.requesterSessionKey?.trim();
  if (!runId || !sessionKey) {
    return undefined;
  }
  const handle = resolvePossessedGovernedParentForRun({ runId, sessionKey });
  if (!handle) {
    return undefined;
  }
  const parentEdge = loadSoraDelegationEdgeByGrantee(sessionKey, "P0_C1");
  if (!parentEdge || parentEdge.revocationReason) {
    return undefined;
  }
  return runId;
}

/**
 * Returns the exact live handle minted for this run+session, without the
 * execution-context requirement. Used only by the attachment wiring itself
 * and the B1 test seam; the governed issuance production path must use
 * `resolvePossessedGovernedParentForRun`.
 */
export function getMintedGovernedParentHandleForRun(params: {
  runId: string;
  sessionKey: string;
}): ActiveGovernedParentHandle | undefined {
  const handle = liveHandleIndex.get(
    handleIndexKey(params.runId?.trim() ?? "", params.sessionKey?.trim() ?? ""),
  );
  return handle && isActiveGovernedParentHandle(handle) ? handle : undefined;
}

const invalidatedHandles = new WeakSet<object>();

function registerHandleLifecycleInvalidation(handle: ActiveGovernedParentHandle): void {
  if (invalidatedHandles.has(handle)) {
    return;
  }
  invalidatedHandles.add(handle);
  const unsubscribe = onAgentRuntimeEvent((evt) => {
    const data = evt.data as { phase?: string; aborted?: boolean } | undefined;
    const isTerminalForRun =
      data?.phase === "end" || data?.phase === "error" || data?.phase === "finishing";
    if (evt.runId === handle.runId && isTerminalForRun) {
      invalidateActiveGovernedParentHandle(handle);
      liveHandleIndex.delete(handleIndexKey(handle.runId, handle.sessionKey));
      unsubscribe();
    }
  });
  // Keyed by the private handleId so multiple handles never clobber each
  // other's rotation entry; the handler is a Map keyed per handle and
  // remains valid until rotation (which invalidates all handles anyway).
  registerAgentEventLifecycleRotationHandler(`sora-governed-parent:${handle.handleId}`, () => {
    invalidateActiveGovernedParentHandle(handle);
    liveHandleIndex.delete(handleIndexKey(handle.runId, handle.sessionKey));
  });
}

/**
 * Test-only factory that bypasses the lifecycle listener wiring but keeps the
 * same private mint path. Used ONLY by the B1 test suite; the production
 * attachment seam is `mintRuntimeGovernedParentHandleForRun`.
 */
export function mintRuntimeGovernedParentHandleForTest(params: {
  runId: string;
  sessionKey: string;
  lifecycleGeneration?: string;
}): ActiveGovernedParentHandle {
  const handle = mintRuntimeOwnedGovernedParentHandle({
    runId: params.runId,
    sessionKey: params.sessionKey,
    lifecycleGeneration: params.lifecycleGeneration ?? "test-generation",
  });
  liveHandleIndex.set(handleIndexKey(handle.runId, handle.sessionKey), handle);
  return handle;
}

export type GovernedAttachmentSeam = {
  mintRuntimeGovernedParentHandleForRun: typeof mintRuntimeGovernedParentHandleForRun;
};
