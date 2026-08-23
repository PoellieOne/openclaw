/**
 * Governed transaction controller (Phase B1).
 *
 * Minimal governed parent transaction lifecycle. Each transaction:
 *
 * - has a governed transaction identity (`TXN_<uuid>`);
 * - moves ACTIVE → COMPLETED | FAILED | ABORTED | CLOSED (terminal states);
 * - carries the lifecycle generation/epoch captured at creation;
 * - carries the authoritative caller binding (session key + run id) DERIVED
 *   from the runtime-owned handle at creation — never from caller input;
 * - is bound to the exact live `ActiveGovernedParentHandle` object at
 *   creation (private object identity; `IDENTIFIER_KNOWLEDGE != POSSESSION`);
 * - fails closed on invalid/stale handles (any lookup that does not resolve
 *   to the exact live handle is a failure);
 * - is invalidatable/closeable explicitly, and becomes unusable for issuance
 *   after closure/invalidation.
 *
 * The controller never creates standing delegation authority: each
 * transaction is a single ephemeral lifecycle object; nothing here grants,
 * caches, or persists authority.
 */
import { randomUUID } from "node:crypto";
import {
  invalidateActiveGovernedParentHandle,
  isActiveGovernedParentHandle,
  type ActiveGovernedParentHandle,
} from "./governed-parent-context.js";

export type GovernedTransactionState = "ACTIVE" | "COMPLETED" | "FAILED" | "ABORTED" | "CLOSED";

export type GovernedParentState =
  | {
      state: "ACTIVE";
      lifecycleGeneration: string;
      authoritativeCallerSessionKey: string;
      authoritativeCallerRunId: string;
    }
  | { state: "TERMINAL"; terminal: GovernedTransactionState };

export type GovernedTransaction = {
  readonly transactionId: string;
  readonly transactionRunId: string;
  readonly lifecycleGeneration: string;
  readonly handle: ActiveGovernedParentHandle;
  readonly authoritativeCallerSessionKey: string;
  readonly authoritativeCallerRunId: string;
  readonly createdAt: number;
  readonly parentState: GovernedParentState;
  readonly state: () => GovernedTransactionState;
  readonly close: (terminal: GovernedTransactionState) => void;
};

const activeTransactionsByHandle = new WeakMap<object, GovernedTransaction>();

function assertActiveHandle(handle: unknown): asserts handle is ActiveGovernedParentHandle {
  if (!isActiveGovernedParentHandle(handle)) {
    throw new Error("governed parent handle is not live process-local possession");
  }
}

/**
 * Creates a new governed parent transaction. Caller must pass the exact live
 * runtime-owned handle; a stale, serialized, or reconstructed value fails
 * closed before any transaction exists. The authoritative caller binding is
 * derived from the handle's own runtime-captured values (never caller input).
 */
export function createGovernedTransaction(params: {
  handle: ActiveGovernedParentHandle;
  now?: number;
}): GovernedTransaction {
  assertActiveHandle(params.handle);
  const handle = params.handle;
  const now = params.now ?? Date.now();
  const transactionId = `TXN_${randomUUID()}`;
  let transactionState: GovernedTransactionState = "ACTIVE";
  const parentState: GovernedParentState = {
    state: "ACTIVE",
    lifecycleGeneration: handle.lifecycleGeneration,
    authoritativeCallerSessionKey: handle.sessionKey,
    authoritativeCallerRunId: handle.runId,
  };
  const transaction: GovernedTransaction = {
    transactionId,
    transactionRunId: handle.runId,
    lifecycleGeneration: handle.lifecycleGeneration,
    handle,
    authoritativeCallerSessionKey: handle.sessionKey,
    authoritativeCallerRunId: handle.runId,
    createdAt: now,
    parentState,
    state: () => transactionState,
    close: (terminal: GovernedTransactionState) => {
      if (transactionState === "ACTIVE") {
        transactionState = terminal;
        activeTransactionsByHandle.delete(handle);
      }
    },
  };
  activeTransactionsByHandle.set(handle, transaction);
  return transaction;
}

/**
 * Returns the live governed transaction bound to the exact handle, or throws
 * fail-closed if the handle is invalid/stale or has no active transaction.
 */
export function resolveGovernedTransactionForHandle(
  handle: ActiveGovernedParentHandle,
): GovernedTransaction {
  assertActiveHandle(handle);
  const transaction = activeTransactionsByHandle.get(handle);
  if (!transaction) {
    throw new Error("no governed transaction bound to this parent handle");
  }
  if (transaction.state() !== "ACTIVE") {
    throw new Error("governed transaction is not ACTIVE");
  }
  return transaction;
}

/**
 * Fail-closed validation: the handle must be live and the transaction must be
 * ACTIVE with matching identity and lifecycle generation. Any mismatch throws.
 */
export function assertGovernedParentActive(params: {
  handle: ActiveGovernedParentHandle;
  transactionId: string;
  lifecycleGeneration: string;
}): void {
  assertActiveHandle(params.handle);
  const transaction = activeTransactionsByHandle.get(params.handle);
  if (!transaction || transaction.transactionId !== params.transactionId) {
    throw new Error("governed transaction identity mismatch");
  }
  if (transaction.state() !== "ACTIVE") {
    throw new Error("governed parent is not ACTIVE");
  }
  if (transaction.lifecycleGeneration !== params.lifecycleGeneration) {
    throw new Error("governed transaction lifecycle generation mismatch");
  }
}

/** Marks the transaction terminal (the bound handle stays live separately). */
export function closeGovernedTransaction(
  transaction: GovernedTransaction,
  terminal: GovernedTransactionState,
): void {
  transaction.close(terminal);
}

/**
 * Invalidates a governed parent end-to-end: closes the bound transaction (if
 * any) and invalidates the process-local handle. Afterwards every subsequent
 * issuance/readiness use of the handle fails closed.
 */
export function invalidateGovernedParent(params: {
  handle: ActiveGovernedParentHandle;
  terminal: GovernedTransactionState;
}): void {
  const transaction = activeTransactionsByHandle.get(params.handle);
  if (transaction) {
    activeTransactionsByHandle.delete(params.handle);
  }
  invalidateActiveGovernedParentHandle(params.handle);
}
