/**
 * SMOKE-003 gated pre-provider run-path observability.
 *
 * Observation-only instrumentation for one governed browser run. Armed only
 * when the exact browser command marker is `SMOKE-003` AND the `smoke003`
 * diagnostic flag is enabled. Emits `smoke003.phase` / `smoke003.exit`
 * diagnostic events and appends the same facts to the existing
 * `trajectory_runtime_events` table. Never alters admission, readiness,
 * fallback, retry, or delivery semantics; never awaits on hot paths.
 */
import { sanitizeDiagnosticPayload } from "../agents/payload-redaction.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { emitDiagnosticEvent } from "../infra/diagnostic-events.js";
import { matchesDiagnosticFlag, resolveDiagnosticFlags } from "../infra/diagnostic-flags.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { appendSqliteTrajectoryRuntimeEvents } from "../trajectory/runtime-store.sqlite.js";

const SMOKE003_FLAG = "smoke003";
const SMOKE003_MARKER = "SMOKE-003";
const SMOKE003_TTL_MS = 10 * 60 * 1000;

type Smoke003ArmedState = {
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  storePath?: string;
  lifecycleRevision?: string;
  armedAt: number;
  completed: boolean;
};

let armedState: Smoke003ArmedState | undefined;

/** Exact governed browser marker check (trimmed equality). */
export function isExactSmoke003Marker(body: string | undefined): boolean {
  return typeof body === "string" && body.trim() === SMOKE003_MARKER;
}

/** Whether the `smoke003` diagnostic flag is enabled for a config. */
export function isSmoke003DiagnosticsEnabled(config: OpenClawConfig | undefined): boolean {
  return matchesDiagnosticFlag(SMOKE003_FLAG, resolveDiagnosticFlags(config));
}

/** Arms observability for one run. Re-arms only after the prior run completed/expired. */
export function armSmoke003Diagnostics(params: {
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  storePath?: string;
  lifecycleRevision?: string;
}): void {
  if (armedState && !armedState.completed) {
    return;
  }
  armedState = {
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
    lifecycleRevision: params.lifecycleRevision,
    armedAt: Date.now(),
    completed: false,
  };
}

/** Binds the runId once known (agentCommandInternal entry / executeAgentTurn). */
export function bindSmoke003RunId(runId: string): void {
  if (!armedState || armedState.completed) {
    return;
  }
  if (armedState.runId === undefined) {
    armedState.runId = runId;
  }
}

/** True only for the exact armed runId, before completion and within TTL. */
export function isSmoke003Armed(runId: string | undefined): boolean {
  if (!armedState || armedState.completed) {
    return false;
  }
  if (armedState.runId === undefined || runId === undefined || runId !== armedState.runId) {
    return false;
  }
  if (Date.now() - armedState.armedAt > SMOKE003_TTL_MS) {
    armedState = undefined;
    return false;
  }
  return true;
}

/** Returns the armed runId when armed (for sites without a local runId). */
export function getSmoke003ArmedRunId(): string | undefined {
  if (!armedState || armedState.completed) {
    return undefined;
  }
  if (Date.now() - armedState.armedAt > SMOKE003_TTL_MS) {
    armedState = undefined;
    return undefined;
  }
  return armedState.runId;
}

/** Clears the armed state after the reply-runner finally completes. */
export function completeSmoke003Diagnostics(runId: string | undefined): void {
  if (!armedState || armedState.completed) {
    return;
  }
  if (runId !== undefined && armedState.runId !== undefined && runId !== armedState.runId) {
    return;
  }
  armedState = undefined;
}

/**
 * Arms observability from the reply-runner entry for the exact governed
 * marker. Returns the armed runId when armed, else undefined.
 */
export function armSmoke003FromReplyRunner(params: {
  isHeartbeat: boolean;
  commandBody: string | undefined;
  config: OpenClawConfig | undefined;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  storePath?: string;
  lifecycleRevision?: string;
}): string | undefined {
  if (params.isHeartbeat || !isSmoke003DiagnosticsEnabled(params.config)) {
    return undefined;
  }
  if (!isExactSmoke003Marker(params.commandBody)) {
    return undefined;
  }
  armSmoke003Diagnostics({
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
    lifecycleRevision: params.lifecycleRevision,
  });
  const armedRunId = getSmoke003ArmedRunId();
  if (armedRunId) {
    emitSmoke003Phase(armedRunId, "REPLY_RUNNER_ENTER", { branch: "user" });
  }
  return armedRunId;
}

/** Emits a pre-provider exception/abort exit for the armed run, if armed. */
export function emitSmoke003RunError(
  runId: string | undefined,
  error: unknown,
  isAbort: boolean,
): void {
  if (runId === undefined || !isSmoke003Armed(runId)) {
    return;
  }
  if (isAbort) {
    emitSmoke003Exit(runId, "PRE_PROVIDER_ABORT", {
      errorClass: smoke003ErrorClassName(error),
      errorCode: error instanceof Error ? error.name : undefined,
    });
  } else {
    emitSmoke003Exit(runId, "PRE_PROVIDER_EXCEPTION", {
      errorClass: smoke003ErrorClassName(error),
    });
  }
}

type Smoke003EventExtra = {
  branch?: string;
  claimAdopted?: boolean;
  writer?: string;
  terminalRunId?: string;
  errorClass?: string;
  errorCode?: string;
  readiness?: { ok: boolean; classification?: string; governed?: boolean };
  provider?: string;
  model?: string;
};

/** Strict allowlist: only these known-safe fields ever leave the module. */
function pickSmoke003SafeFields(extra: Smoke003EventExtra): Smoke003EventExtra {
  const safe: Smoke003EventExtra = {};
  if (extra.branch !== undefined) {
    safe.branch = extra.branch;
  }
  if (extra.claimAdopted !== undefined) {
    safe.claimAdopted = extra.claimAdopted;
  }
  if (extra.writer !== undefined) {
    safe.writer = extra.writer;
  }
  if (extra.terminalRunId !== undefined) {
    safe.terminalRunId = extra.terminalRunId;
  }
  if (extra.errorClass !== undefined) {
    safe.errorClass = extra.errorClass;
  }
  if (extra.errorCode !== undefined) {
    safe.errorCode = extra.errorCode;
  }
  if (extra.readiness !== undefined) {
    safe.readiness = {
      ok: extra.readiness.ok,
      ...(extra.readiness.classification !== undefined
        ? { classification: extra.readiness.classification }
        : {}),
      ...(extra.readiness.governed !== undefined ? { governed: extra.readiness.governed } : {}),
    };
  }
  if (extra.provider !== undefined) {
    safe.provider = extra.provider;
  }
  if (extra.model !== undefined) {
    safe.model = extra.model;
  }
  return safe;
}

/** Emits one smoke003.phase event (diagnostic bus + trajectory row). */
export function emitSmoke003Phase(
  runId: string,
  phase: string,
  extra: Smoke003EventExtra = {},
): void {
  if (!isSmoke003Armed(runId)) {
    return;
  }
  const state = armedState;
  if (!state) {
    return;
  }
  const payload = {
    type: "smoke003.phase" as const,
    runId,
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    ...(state.sessionKey ? { sessionKey: state.sessionKey } : {}),
    phase,
    ...pickSmoke003SafeFields(extra),
  };
  emitDiagnosticEvent(sanitizeDiagnosticPayload(payload) as typeof payload);
  appendTrajectoryEvent(state, "smoke003.phase", payload);
}

/** Emits one smoke003.exit event (diagnostic bus + trajectory row). */
export function emitSmoke003Exit(
  runId: string,
  phase: string,
  extra: Smoke003EventExtra = {},
): void {
  if (!isSmoke003Armed(runId)) {
    return;
  }
  const state = armedState;
  if (!state) {
    return;
  }
  const payload = {
    type: "smoke003.exit" as const,
    runId,
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    ...(state.sessionKey ? { sessionKey: state.sessionKey } : {}),
    phase,
    ...pickSmoke003SafeFields(extra),
  };
  emitDiagnosticEvent(sanitizeDiagnosticPayload(payload) as typeof payload);
  appendTrajectoryEvent(state, "smoke003.exit", payload);
}

function appendTrajectoryEvent(
  state: Smoke003ArmedState,
  type: string,
  data: Record<string, unknown>,
): void {
  if (!state.sessionId || !state.storePath) {
    return;
  }
  let agentId: string | undefined;
  try {
    agentId = state.sessionKey ? resolveAgentIdFromSessionKey(state.sessionKey) : undefined;
  } catch {
    return;
  }
  if (!agentId) {
    return;
  }
  try {
    appendSqliteTrajectoryRuntimeEvents(
      { agentId, sessionId: state.sessionId, storePath: state.storePath },
      [
        {
          traceSchema: "openclaw-trajectory",
          schemaVersion: 1,
          traceId: state.sessionId,
          source: "runtime",
          type,
          ts: new Date().toISOString(),
          seq: 0,
          sessionId: state.sessionId,
          ...(state.sessionKey ? { sessionKey: state.sessionKey } : {}),
          runId: state.runId,
          data: sanitizeDiagnosticPayload(data) as Record<string, unknown>,
        },
      ],
    );
  } catch {
    // Observation-only: persistence failure must never affect the run.
  }
}

/** Resolves a bounded error class name for safe payloads. */
export function smoke003ErrorClassName(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.constructor.name;
  }
  if (typeof error === "string") {
    return "string";
  }
  return undefined;
}

/** Test-only reset. */
export function resetSmoke003DiagnosticsForTest(): void {
  armedState = undefined;
}
