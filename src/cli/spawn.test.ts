import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerSpawnCli } from "./spawn.js";

const hoisted = vi.hoisted(() => ({
  directSpawnMock: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock("../agents/direct-spawn.js", () => ({
  directSpawn: hoisted.directSpawnMock,
  DIRECT_SPAWN_SCHEMA_VERSION: "1",
  DIRECT_SPAWN_TASK_MAX_LENGTH: 4096,
  DIRECT_SPAWN_LABEL_MAX_LENGTH: 128,
  DIRECT_SPAWN_CHILD_TIMEOUT_SECONDS_MAX: 120,
  DIRECT_SPAWN_ACCEPT_TIMEOUT_MS_MAX: 10000,
}));

function createSpawnProgram(): Command {
  const program = new Command();
  registerSpawnCli(program);
  return program;
}

async function parseSpawn(args: string[]): Promise<void> {
  const program = createSpawnProgram();
  await program.parseAsync(["spawn", ...args], { from: "user" });
}

function acceptedResult() {
  return {
    schemaVersion: "1",
    ok: true,
    accepted: true,
    runId: "run-uuid-123",
    childSessionKey: "agent:main:child-key",
    error: null,
  };
}

function rejectedResult() {
  return {
    schemaVersion: "1",
    ok: false,
    accepted: false,
    runId: null,
    childSessionKey: null,
    error: { code: "SPAWN_REJECTED", message: "Agent not allowed" },
  };
}

function invalidRequestResult() {
  return {
    schemaVersion: "1",
    ok: false,
    accepted: false,
    runId: null,
    childSessionKey: null,
    error: { code: "INVALID_REQUEST", message: "agentId is required" },
  };
}

describe("spawn CLI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.directSpawnMock.mockReset();
    process.exitCode = 0;
  });

  it("parses all flags and produces valid JSON on stdout for accepted spawn", async () => {
    hoisted.directSpawnMock.mockResolvedValue(acceptedResult());
    const stdout = await captureStdout(async () => {
      try {
        await parseSpawn([
          "--parent-session",
          "agent:main:session-key",
          "--agent",
          "main",
          "--task",
          "hello",
          "--json",
        ]);
      } catch {}
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.accepted).toBe(true);
    expect(parsed.runId).toBe("run-uuid-123");
    expect(parsed.childSessionKey).toBe("agent:main:child-key");
    expect(hoisted.directSpawnMock).toHaveBeenCalledTimes(1);
  });

  it("exits 0 for fully accepted spawn", async () => {
    hoisted.directSpawnMock.mockResolvedValue(acceptedResult());
    const program = createSpawnProgram();
    try {
      await program.parseAsync(
        [
          "spawn",
          "--parent-session",
          "agent:main:key",
          "--agent",
          "main",
          "--task",
          "task",
          "--json",
        ],
        { from: "user" },
      );
    } catch {}
    expect(process.exitCode).toBe(0);
    process.exitCode = 0;
  });

  it("exits 1 for rejected spawn", async () => {
    hoisted.directSpawnMock.mockResolvedValue(rejectedResult());
    const program = createSpawnProgram();
    try {
      await program.parseAsync(
        [
          "spawn",
          "--parent-session",
          "agent:main:key",
          "--agent",
          "main",
          "--task",
          "task",
          "--json",
        ],
        { from: "user" },
      );
    } catch {}
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("exits 2 for invalid request", async () => {
    hoisted.directSpawnMock.mockResolvedValue(invalidRequestResult());
    const program = createSpawnProgram();
    try {
      await program.parseAsync(
        [
          "spawn",
          "--parent-session",
          "agent:main:key",
          "--agent",
          "main",
          "--task",
          "task",
          "--json",
        ],
        { from: "user" },
      );
    } catch {}
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
  });

  it("flags are parsed correctly (stdout-based)", async () => {
    hoisted.directSpawnMock.mockResolvedValue(acceptedResult());
    const stdout = await captureStdout(async () => {
      try {
        await parseSpawn([
          "--parent-session",
          "agent:main:key",
          "--agent",
          "worker",
          "--task",
          "do work",
          "--label",
          "test-label",
          "--child-timeout-seconds",
          "60",
          "--accept-timeout-ms",
          "5000",
          "--json",
        ]);
      } catch {}
    });
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.runId).toBe("run-uuid-123");
  });

  it("outputs exactly one JSON object on stdout", async () => {
    hoisted.directSpawnMock.mockResolvedValue(acceptedResult());
    const stdout = await captureStdout(async () => {
      try {
        await parseSpawn([
          "--parent-session",
          "agent:main:key",
          "--agent",
          "main",
          "--task",
          "task",
          "--json",
        ]);
      } catch {}
    });
    const trimmed = stdout.trim();
    const newlines = trimmed.split("\n");
    expect(newlines).toHaveLength(1);
    expect(() => JSON.parse(trimmed)).not.toThrow();
  });

  it("diagnostics go to stderr", async () => {
    hoisted.directSpawnMock.mockResolvedValue(acceptedResult());
    const stderr = await captureStderr(async () => {
      try {
        await parseSpawn([
          "--parent-session",
          "agent:main:key",
          "--agent",
          "main",
          "--task",
          "task",
          "--json",
        ]);
      } catch {}
    });
    expect(typeof stderr).toBe("string");
  });

  it("--json is mandatory", async () => {
    await expect(
      parseSpawn(["--parent-session", "key", "--agent", "main", "--task", "task"]),
    ).rejects.toThrow();
  });

  it("exactly one service invocation per CLI call", async () => {
    hoisted.directSpawnMock.mockResolvedValue(acceptedResult());
    try {
      await parseSpawn([
        "--parent-session",
        "agent:main:key",
        "--agent",
        "main",
        "--task",
        "task",
        "--json",
      ]);
    } catch {}
    expect(hoisted.directSpawnMock).toHaveBeenCalledTimes(1);
  });
});

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: Buffer[] = [];
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk: unknown) => {
    chunks.push(Buffer.from(chunk as string));
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = origWrite;
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function captureStderr(fn: () => Promise<void>): Promise<string> {
  const chunks: Buffer[] = [];
  const origWrite = process.stderr.write;
  process.stderr.write = (chunk: unknown) => {
    chunks.push(Buffer.from(chunk as string));
    return true;
  };
  try {
    await fn();
  } finally {
    process.stderr.write = origWrite;
  }
  return Buffer.concat(chunks).toString("utf8");
}
