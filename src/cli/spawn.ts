import type { Command } from "commander";
import {
  directSpawn,
  DIRECT_SPAWN_ACCEPT_TIMEOUT_MS_MAX,
  DIRECT_SPAWN_CHILD_TIMEOUT_SECONDS_MAX,
  DIRECT_SPAWN_TASK_MAX_LENGTH,
  DIRECT_SPAWN_SCHEMA_VERSION,
} from "../agents/direct-spawn.js";
import type {
  DirectSpawnContext,
  DirectSpawnRequest,
  DirectSpawnResult,
} from "../agents/direct-spawn.js";

export function registerSpawnCli(program: Command) {
  program
    .command("spawn")
    .description("Spawn a subagent directly (local root-operator surface)")
    .requiredOption("--parent-session <key>", "Parent session key")
    .requiredOption("--agent <id>", "Agent ID to spawn")
    .option("--task <text>", "Task description (or pipe via stdin)")
    .option("--label <text>", "Optional spawn label")
    .option(
      "--child-timeout-seconds <n>",
      `Child execution timeout in seconds (max ${DIRECT_SPAWN_CHILD_TIMEOUT_SECONDS_MAX})`,
      parsePositiveInt,
    )
    .option(
      "--accept-timeout-ms <n>",
      `Spawn acceptance timeout in ms (max ${DIRECT_SPAWN_ACCEPT_TIMEOUT_MS_MAX})`,
      parsePositiveInt,
    )
    .requiredOption("--json", "JSON output mode (mandatory)")
    .action(actionHandler);
}

function parsePositiveInt(value: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  return n;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function buildRequestFromFlags(
  flags: Record<string, unknown>,
  taskFromStdin?: string,
): DirectSpawnRequest {
  const schemaVersion = DIRECT_SPAWN_SCHEMA_VERSION;
  const parentSessionKey = flags["parent-session"] as string;
  const agentId = flags["agent"] as string;
  const task = (flags["task"] as string) ?? taskFromStdin ?? "";
  const label = flags["label"] as string | undefined;
  const childTimeoutSeconds = flags["child-timeout-seconds"] as number | undefined;
  return { schemaVersion, parentSessionKey, agentId, task, label, childTimeoutSeconds };
}

async function buildContext(): Promise<DirectSpawnContext> {
  const logger = {
    warn(msg: string) {
      process.stderr.write(`WARN: ${msg}\n`);
    },
    error(msg: string) {
      process.stderr.write(`ERR: ${msg}\n`);
    },
  };
  let loadSessionEntryFn: ((scope: { agentId: string; sessionKey: string }) => unknown) | undefined;
  let resolveAgentConfigFn:
    | ((cfg: unknown, agentId: string) => Record<string, unknown> | undefined)
    | undefined;
  let runtimeCfg: unknown;
  try {
    const sessionMod = await import("../config/sessions/session-accessor.js");
    loadSessionEntryFn = (sessionMod as Record<string, unknown>)
      .loadSessionEntry as typeof loadSessionEntryFn;
    const agentMod = await import("../agents/agent-scope-config.js");
    resolveAgentConfigFn = (agentMod as Record<string, unknown>)
      .resolveAgentConfig as typeof resolveAgentConfigFn;
    const cfgMod = await import("../config/config.js");
    runtimeCfg = (cfgMod as Record<string, unknown>).getRuntimeConfig as () => unknown;
  } catch {
    logger.error("Runtime imports not available in this context");
  }
  return {
    sessionStore: {
      async loadSessionEntry(_key: string) {
        if (!loadSessionEntryFn) return null;
        const entry = loadSessionEntryFn({ agentId: "", sessionKey: _key }) as
          | Record<string, unknown>
          | undefined;
        if (!entry) return null;
        return {
          state: String(entry.state ?? ""),
          config: (entry.config ?? {}) as Record<string, unknown>,
        };
      },
    },
    agentConfig: {
      async resolveAgentConfig(agentId: string) {
        if (!resolveAgentConfigFn || !runtimeCfg) return null;
        const cfgVal = typeof runtimeCfg === "function" ? runtimeCfg() : runtimeCfg;
        return resolveAgentConfigFn(cfgVal, agentId) ?? null;
      },
    },
    subagentRegistry: {
      getCurrentSpawnDepth(_sessionKey: string) {
        return 0;
      },
    },
    clock: { now: () => Date.now() },
    logger,
  };
}

async function actionHandler(this: Command): Promise<void> {
  const flags = this.optsWithGlobals();

  let taskFromStdin: string | undefined;
  if (!flags["task"] && !process.stdin.isTTY) {
    taskFromStdin = await readStdin();
    if (taskFromStdin.length > DIRECT_SPAWN_TASK_MAX_LENGTH) {
      writeResult({
        schemaVersion: DIRECT_SPAWN_SCHEMA_VERSION,
        ok: false,
        accepted: false,
        runId: null,
        childSessionKey: null,
        error: {
          code: "INVALID_REQUEST",
          message: `stdin task exceeds ${DIRECT_SPAWN_TASK_MAX_LENGTH} characters`,
        },
      });
      process.exitCode = 2;
      return;
    }
  }

  const request = buildRequestFromFlags(flags, taskFromStdin);
  const acceptTimeoutMs =
    (flags["accept-timeout-ms"] as number) ?? DIRECT_SPAWN_ACCEPT_TIMEOUT_MS_MAX;

  if (acceptTimeoutMs > DIRECT_SPAWN_ACCEPT_TIMEOUT_MS_MAX) {
    writeResult({
      schemaVersion: DIRECT_SPAWN_SCHEMA_VERSION,
      ok: false,
      accepted: false,
      runId: null,
      childSessionKey: null,
      error: {
        code: "INVALID_REQUEST",
        message: `accept-timeout-ms exceeds ${DIRECT_SPAWN_ACCEPT_TIMEOUT_MS_MAX}`,
      },
    });
    process.exitCode = 2;
    return;
  }

  const ctx = await buildContext();
  const result = await directSpawn(request, ctx, { acceptTimeoutMs });

  writeResult(result);

  if (result.ok && result.accepted && result.runId && result.childSessionKey) {
    process.exitCode = 0;
  } else if (!result.ok && result.error?.code === "INVALID_REQUEST") {
    process.exitCode = 2;
  } else {
    process.exitCode = 1;
  }
}

function writeResult(result: DirectSpawnResult): void {
  process.stdout.write(JSON.stringify(result) + "\n");
}
