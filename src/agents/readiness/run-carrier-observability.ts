/**
 * Run-carrier observability for governed P1-equivalent runs.
 *
 * Observation-only instrumentation shared by the core reply runner and the
 * Codex app-server harness. Emits one `run.carrier.diagnostic` event per
 * contract phase (STAGE_A → EMBEDDED_ENTRY → ATTEMPT_DISPATCH → CODEX_ENTRY →
 * BOOTSTRAP_PRE → BOOTSTRAP_POST → GATE2) and appends the same bounded facts
 * to the existing `trajectory_runtime_events` store. Armed only when the
 * `run.carrier.diagnostic` diagnostic flag is enabled. Never throws, never
 * awaits on hot paths, never mutates any input, and never alters readiness,
 * admission, or control flow.
 */
import { createHash } from "node:crypto";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { hasInternalHookListeners } from "../../hooks/internal-hooks.js";
import { emitDiagnosticEvent } from "../../infra/diagnostic-events.js";
import { matchesDiagnosticFlag, resolveDiagnosticFlags } from "../../infra/diagnostic-flags.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { appendSqliteTrajectoryRuntimeEvents } from "../../trajectory/runtime-store.sqlite.js";
import { sanitizeDiagnosticPayload } from "../payload-redaction.js";

export const RUN_CARRIER_DIAGNOSTIC_FLAG = "run.carrier.diagnostic";

export const RUN_CARRIER_DIAGNOSTIC_PHASES = [
  "STAGE_A",
  "EMBEDDED_ENTRY",
  "ATTEMPT_DISPATCH",
  "CODEX_ENTRY",
  "BOOTSTRAP_PRE",
  "BOOTSTRAP_POST",
  "GATE2",
] as const;

export type RunCarrierDiagnosticPhase = (typeof RUN_CARRIER_DIAGNOSTIC_PHASES)[number];

export type RunCarrierDiagnosticFacts = {
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  storePath?: string;
  config?: OpenClawConfig;
  phase: RunCarrierDiagnosticPhase;
  attemptId?: string;
  governed?: boolean;
  decision?: string;
  mayExecute?: boolean;
  hasReadinessGovernance?: boolean;
  hasRunLocalProjectionState?: boolean;
  projectionId?: string;
  projectionDigest?: string;
  bootstrapEntryCount?: number;
  bootstrapEntryNames?: string[];
  containsReadinessGovernance?: boolean;
  containsGenericSoulIdentity?: boolean;
  injectionAssertionStatus?: string;
  injectionDigest?: string;
  governedAdmission?: boolean;
  hasHolder?: boolean;
  stageBOk?: boolean;
  stageBCode?: string | null;
  dispatch?: "allowed" | "blocked";
};

/** Whether the `run.carrier.diagnostic` diagnostic flag is enabled for a config. */
export function isRunCarrierDiagnosticsEnabled(config: OpenClawConfig | undefined): boolean {
  return matchesDiagnosticFlag(RUN_CARRIER_DIAGNOSTIC_FLAG, resolveDiagnosticFlags(config));
}

/** Bounded sessionKey identifier: SHA-256 prefix 16. Never the raw key. */
export function hashRunCarrierSessionKey(sessionKey: string | undefined): string | undefined {
  if (!sessionKey) {
    return undefined;
  }
  return createHash("sha256").update(sessionKey, "utf-8").digest("hex").slice(0, 16);
}

/**
 * Emits one bounded run-carrier diagnostic event plus a trajectory row.
 * Fail-closed: never throws, never awaits, never mutates any input.
 */
export function emitRunCarrierDiagnostic(facts: RunCarrierDiagnosticFacts): void {
  try {
    if (!RUN_CARRIER_DIAGNOSTIC_PHASES.includes(facts.phase)) {
      return;
    }
    if (!isRunCarrierDiagnosticsEnabled(facts.config)) {
      return;
    }
    const payload = {
      type: "run.carrier.diagnostic" as const,
      diagnostic_version: 1 as const,
      ...(facts.runId ? { runId: facts.runId } : {}),
      ...(facts.sessionId ? { sessionId: facts.sessionId } : {}),
      ...(facts.sessionKey ? { sessionKey: hashRunCarrierSessionKey(facts.sessionKey) } : {}),
      phase: facts.phase,
      timestamp: new Date().toISOString(),
      ...(facts.attemptId ? { attemptId: facts.attemptId } : {}),
      ...(facts.governed !== undefined ? { governed: facts.governed } : {}),
      ...(facts.decision ? { decision: facts.decision } : {}),
      ...(facts.mayExecute !== undefined ? { mayExecute: facts.mayExecute } : {}),
      ...(facts.hasReadinessGovernance !== undefined
        ? { hasReadinessGovernance: facts.hasReadinessGovernance }
        : {}),
      ...(facts.hasRunLocalProjectionState !== undefined
        ? { hasRunLocalProjectionState: facts.hasRunLocalProjectionState }
        : {}),
      ...(facts.projectionId ? { projectionId: facts.projectionId } : {}),
      ...(facts.projectionDigest ? { projectionDigest: facts.projectionDigest } : {}),
      ...(facts.bootstrapEntryCount !== undefined
        ? { bootstrapEntryCount: facts.bootstrapEntryCount }
        : {}),
      ...(facts.bootstrapEntryNames ? { bootstrapEntryNames: facts.bootstrapEntryNames } : {}),
      ...(facts.containsReadinessGovernance !== undefined
        ? { containsReadinessGovernance: facts.containsReadinessGovernance }
        : {}),
      ...(facts.containsGenericSoulIdentity !== undefined
        ? { containsGenericSoulIdentity: facts.containsGenericSoulIdentity }
        : {}),
      ...(facts.injectionAssertionStatus
        ? { injectionAssertionStatus: facts.injectionAssertionStatus }
        : {}),
      ...(facts.injectionDigest ? { injectionDigest: facts.injectionDigest } : {}),
      ...(facts.governedAdmission !== undefined
        ? { governedAdmission: facts.governedAdmission }
        : {}),
      ...(facts.hasHolder !== undefined ? { hasHolder: facts.hasHolder } : {}),
      ...(facts.stageBOk !== undefined ? { stageBOk: facts.stageBOk } : {}),
      ...(facts.stageBCode !== undefined ? { stageBCode: facts.stageBCode } : {}),
      ...(facts.dispatch ? { dispatch: facts.dispatch } : {}),
      ...(facts.phase === "BOOTSTRAP_PRE"
        ? { hookRegistryHasBootstrapHandler: hasInternalHookListeners("agent", "bootstrap") }
        : {}),
    };
    emitDiagnosticEvent(sanitizeDiagnosticPayload(payload) as typeof payload);
    appendTrajectoryEvent(facts, payload);
  } catch {
    // Observation-only: a diagnostic failure must never alter readiness or control flow.
  }
}

function appendTrajectoryEvent(
  facts: RunCarrierDiagnosticFacts,
  payload: Record<string, unknown>,
): void {
  if (!facts.sessionId || !facts.storePath || !facts.sessionKey) {
    return;
  }
  let agentId: string | undefined;
  try {
    agentId = resolveAgentIdFromSessionKey(facts.sessionKey);
  } catch {
    return;
  }
  if (!agentId) {
    return;
  }
  try {
    appendSqliteTrajectoryRuntimeEvents(
      { agentId, sessionId: facts.sessionId, storePath: facts.storePath },
      [
        {
          traceSchema: "openclaw-trajectory",
          schemaVersion: 1,
          traceId: facts.sessionId,
          source: "runtime",
          type: "run.carrier.diagnostic",
          ts: new Date().toISOString(),
          seq: 0,
          sessionId: facts.sessionId,
          ...(facts.sessionKey ? { sessionKey: hashRunCarrierSessionKey(facts.sessionKey) } : {}),
          ...(facts.runId ? { runId: facts.runId } : {}),
          data: sanitizeDiagnosticPayload(payload) as Record<string, unknown>,
        },
      ],
    );
  } catch {
    // Observation-only: persistence failure must never affect the run.
  }
}
