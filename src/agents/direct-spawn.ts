import { spawnSubagentDirect } from "./subagent-spawn.js";

type ProducerParams = {
  task: string;
  label?: string;
  agentId?: string;
  runTimeoutSeconds?: number;
};

type ProducerContext = {
  agentSessionKey?: string;
};

type ProducerResult = {
  status: "accepted" | "forbidden" | "error";
  childSessionKey?: string;
  runId?: string;
  error?: string;
};

export const DIRECT_SPAWN_SCHEMA_VERSION = "1" as const;

export const DIRECT_SPAWN_TASK_MAX_LENGTH = 4096;
export const DIRECT_SPAWN_LABEL_MAX_LENGTH = 128;
export const DIRECT_SPAWN_CHILD_TIMEOUT_SECONDS_MAX = 120;
export const DIRECT_SPAWN_ACCEPT_TIMEOUT_MS_MAX = 10000;

export interface DirectSpawnRequest {
  schemaVersion: string;
  parentSessionKey: string;
  agentId: string;
  task: string;
  label?: string;
  childTimeoutSeconds?: number;
}

export interface DirectSpawnContext {
  sessionStore: {
    loadSessionEntry(
      key: string,
    ): Promise<{ state: string; config: Record<string, unknown> } | null>;
  };
  agentConfig: {
    resolveAgentConfig(agentId: string): Promise<Record<string, unknown> | null>;
  };
  subagentRegistry: {
    getCurrentSpawnDepth(sessionKey: string): number;
  };
  clock: { now(): number };
  logger: { warn(msg: string): void; error(msg: string): void };
}

export interface DirectSpawnError {
  code: string;
  message: string;
}

export interface DirectSpawnResult {
  schemaVersion: string;
  ok: boolean;
  accepted: boolean;
  runId: string | null;
  childSessionKey: string | null;
  error: DirectSpawnError | null;
}

interface DirectSpawnOptions {
  acceptTimeoutMs: number;
}

function validateRequest(request: DirectSpawnRequest): DirectSpawnError | null {
  if (request.schemaVersion !== DIRECT_SPAWN_SCHEMA_VERSION) {
    return { code: "INVALID_REQUEST", message: "Unsupported schemaVersion" };
  }
  if (typeof request.parentSessionKey !== "string" || request.parentSessionKey.length === 0) {
    return { code: "INVALID_REQUEST", message: "parentSessionKey is required" };
  }
  if (typeof request.agentId !== "string" || request.agentId.length === 0) {
    return { code: "INVALID_REQUEST", message: "agentId is required" };
  }
  if (typeof request.task !== "string" || request.task.length === 0) {
    return { code: "INVALID_REQUEST", message: "task is required" };
  }
  if (request.task.length > DIRECT_SPAWN_TASK_MAX_LENGTH) {
    return {
      code: "INVALID_REQUEST",
      message: `task exceeds ${DIRECT_SPAWN_TASK_MAX_LENGTH} characters`,
    };
  }
  if (request.label !== undefined) {
    if (typeof request.label !== "string") {
      return { code: "INVALID_REQUEST", message: "label must be a string" };
    }
    if (request.label.length > DIRECT_SPAWN_LABEL_MAX_LENGTH) {
      return {
        code: "INVALID_REQUEST",
        message: `label exceeds ${DIRECT_SPAWN_LABEL_MAX_LENGTH} characters`,
      };
    }
  }
  if (request.childTimeoutSeconds !== undefined) {
    if (
      typeof request.childTimeoutSeconds !== "number" ||
      request.childTimeoutSeconds <= 0 ||
      request.childTimeoutSeconds > DIRECT_SPAWN_CHILD_TIMEOUT_SECONDS_MAX
    ) {
      return {
        code: "INVALID_REQUEST",
        message: `childTimeoutSeconds must be 1-${DIRECT_SPAWN_CHILD_TIMEOUT_SECONDS_MAX}`,
      };
    }
  }
  const knownKeys = new Set([
    "schemaVersion",
    "parentSessionKey",
    "agentId",
    "task",
    "label",
    "childTimeoutSeconds",
  ]);
  for (const key of Object.keys(request)) {
    if (!knownKeys.has(key)) {
      return { code: "INVALID_REQUEST", message: `Unknown field: ${key}` };
    }
  }
  return null;
}

function sanitizeError(message: string): string {
  const credentialsPattern = /(?:key|token|secret|password|auth|credential)[=:]\s*\S+/gi;
  const pathPattern = /\/[a-zA-Z0-9_\-./]{2,}/g;
  let sanitized = message.replace(credentialsPattern, "[REDACTED]");
  sanitized = sanitized.replace(pathPattern, "[PATH]");
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 500) + "...";
  }
  return sanitized;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function convertProducerResult(result: ProducerResult): DirectSpawnResult {
  if (result.status === "accepted") {
    return {
      schemaVersion: DIRECT_SPAWN_SCHEMA_VERSION,
      ok: true,
      accepted: true,
      runId: result.runId ?? null,
      childSessionKey: result.childSessionKey ?? null,
      error: null,
    };
  }
  if (result.status === "forbidden") {
    return {
      schemaVersion: DIRECT_SPAWN_SCHEMA_VERSION,
      ok: false,
      accepted: false,
      runId: null,
      childSessionKey: null,
      error: {
        code: "SPAWN_REJECTED",
        message: sanitizeError(result.error ?? "Spawn rejected by policy"),
      },
    };
  }
  return {
    schemaVersion: DIRECT_SPAWN_SCHEMA_VERSION,
    ok: false,
    accepted: false,
    runId: null,
    childSessionKey: null,
    error: {
      code: "INTERNAL_SPAWN_FAILURE_SANITIZED",
      message: sanitizeError(result.error ?? "Unknown spawn error"),
    },
  };
}

function buildProducerParams(
  request: DirectSpawnRequest,
  _ctx: DirectSpawnContext,
): ProducerParams {
  return {
    task: request.task,
    ...(request.label ? { label: request.label } : {}),
    agentId: request.agentId,
    ...(request.childTimeoutSeconds ? { runTimeoutSeconds: request.childTimeoutSeconds } : {}),
  };
}

function buildProducerContext(
  request: DirectSpawnRequest,
  _ctx: DirectSpawnContext,
): ProducerContext {
  return {
    agentSessionKey: request.parentSessionKey,
  };
}

export async function directSpawn(
  request: DirectSpawnRequest,
  ctx: DirectSpawnContext,
  options?: Partial<DirectSpawnOptions>,
): Promise<DirectSpawnResult> {
  const validationError = validateRequest(request);
  if (validationError) {
    return {
      schemaVersion: DIRECT_SPAWN_SCHEMA_VERSION,
      ok: false,
      accepted: false,
      runId: null,
      childSessionKey: null,
      error: validationError,
    };
  }

  const acceptTimeoutMs = options?.acceptTimeoutMs ?? DIRECT_SPAWN_ACCEPT_TIMEOUT_MS_MAX;

  const sessionEntry = await ctx.sessionStore.loadSessionEntry(request.parentSessionKey);
  if (!sessionEntry) {
    return {
      schemaVersion: DIRECT_SPAWN_SCHEMA_VERSION,
      ok: false,
      accepted: false,
      runId: null,
      childSessionKey: null,
      error: { code: "PARENT_SESSION_NOT_FOUND", message: "Parent session not found" },
    };
  }

  if (sessionEntry.state !== "active") {
    return {
      schemaVersion: DIRECT_SPAWN_SCHEMA_VERSION,
      ok: false,
      accepted: false,
      runId: null,
      childSessionKey: null,
      error: { code: "PARENT_CONTEXT_INVALID", message: "Parent session is not active" },
    };
  }

  const agentConfig = await ctx.agentConfig.resolveAgentConfig(request.agentId);
  if (!agentConfig) {
    return {
      schemaVersion: DIRECT_SPAWN_SCHEMA_VERSION,
      ok: false,
      accepted: false,
      runId: null,
      childSessionKey: null,
      error: { code: "AGENT_NOT_FOUND", message: `Agent '${request.agentId}' not found` },
    };
  }

  const producerParams = buildProducerParams(request, ctx);
  const producerContext = buildProducerContext(request, ctx);

  let producerResult: ProducerResult;
  try {
    const result = await Promise.race([
      spawnSubagentDirect(producerParams, producerContext),
      delay(acceptTimeoutMs).then<"TIMEOUT">(() => "TIMEOUT"),
    ]);
    if (result === "TIMEOUT") {
      return {
        schemaVersion: DIRECT_SPAWN_SCHEMA_VERSION,
        ok: false,
        accepted: false,
        runId: null,
        childSessionKey: null,
        error: {
          code: "SPAWN_ACCEPT_TIMEOUT_NO_IDENTIFIERS",
          message: "Spawn acceptance timed out",
        },
      };
    }
    producerResult = result;
  } catch (err) {
    return {
      schemaVersion: DIRECT_SPAWN_SCHEMA_VERSION,
      ok: false,
      accepted: false,
      runId: null,
      childSessionKey: null,
      error: {
        code: "INTERNAL_SPAWN_FAILURE_SANITIZED",
        message: sanitizeError(err instanceof Error ? err.message : String(err)),
      },
    };
  }

  return convertProducerResult(producerResult);
}
