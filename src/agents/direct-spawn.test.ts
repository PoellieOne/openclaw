import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  directSpawn,
  DIRECT_SPAWN_SCHEMA_VERSION,
  DIRECT_SPAWN_TASK_MAX_LENGTH,
  DIRECT_SPAWN_LABEL_MAX_LENGTH,
  DIRECT_SPAWN_CHILD_TIMEOUT_SECONDS_MAX,
} from "./direct-spawn.js";
import type { DirectSpawnContext, DirectSpawnRequest } from "./direct-spawn.js";

const hoisted = vi.hoisted(() => ({
  spawnSubagentDirectMock: vi.fn(),
}));

vi.mock("./subagent-spawn.js", () => ({
  spawnSubagentDirect: hoisted.spawnSubagentDirectMock,
}));

function createValidRequest(): DirectSpawnRequest {
  return {
    schemaVersion: "1",
    parentSessionKey: "agent:main:session-key",
    agentId: "main",
    task: "return exactly OK",
  };
}

function createMockContext(overrides?: Partial<DirectSpawnContext>): DirectSpawnContext {
  return {
    sessionStore: {
      async loadSessionEntry() {
        return { state: "active", config: {} };
      },
    },
    agentConfig: {
      async resolveAgentConfig() {
        return { id: "main", workspace: "/tmp" };
      },
    },
    subagentRegistry: {
      getCurrentSpawnDepth() {
        return 0;
      },
    },
    clock: { now: () => Date.now() },
    logger: { warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe("directSpawn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.spawnSubagentDirectMock.mockResolvedValue({
      status: "accepted",
      childSessionKey: "agent:main:child-key",
      runId: "run-uuid-123",
    });
  });

  it("strict valid request calls producer exactly once", async () => {
    const result = await directSpawn(createValidRequest(), createMockContext());
    expect(result.ok).toBe(true);
    expect(result.accepted).toBe(true);
    expect(result.runId).toBe("run-uuid-123");
    expect(result.childSessionKey).toBe("agent:main:child-key");
    expect(hoisted.spawnSubagentDirectMock).toHaveBeenCalledTimes(1);
  });

  it("rejects missing parentSessionKey with INVALID_REQUEST", async () => {
    const request = createValidRequest();
    request.parentSessionKey = "";
    const result = await directSpawn(request, createMockContext());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_REQUEST");
    expect(hoisted.spawnSubagentDirectMock).not.toHaveBeenCalled();
  });

  it("rejects missing agentId with INVALID_REQUEST", async () => {
    const request = createValidRequest();
    request.agentId = "";
    const result = await directSpawn(request, createMockContext());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_REQUEST");
    expect(hoisted.spawnSubagentDirectMock).not.toHaveBeenCalled();
  });

  it("rejects missing task with INVALID_REQUEST", async () => {
    const request = createValidRequest();
    request.task = "";
    const result = await directSpawn(request, createMockContext());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_REQUEST");
    expect(hoisted.spawnSubagentDirectMock).not.toHaveBeenCalled();
  });

  it("rejects unknown fields with INVALID_REQUEST", async () => {
    const request = { ...createValidRequest(), unknownField: "bad" };
    const result = await directSpawn(request as DirectSpawnRequest, createMockContext());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_REQUEST");
    expect(hoisted.spawnSubagentDirectMock).not.toHaveBeenCalled();
  });

  it("returns PARENT_SESSION_NOT_FOUND when session does not exist", async () => {
    const ctx = createMockContext({
      sessionStore: {
        async loadSessionEntry() {
          return null;
        },
      },
    });
    const result = await directSpawn(createValidRequest(), ctx);
    expect(result.error?.code).toBe("PARENT_SESSION_NOT_FOUND");
    expect(hoisted.spawnSubagentDirectMock).not.toHaveBeenCalled();
  });

  it("returns PARENT_CONTEXT_INVALID when session is not active", async () => {
    const ctx = createMockContext({
      sessionStore: {
        async loadSessionEntry() {
          return { state: "closed", config: {} };
        },
      },
    });
    const result = await directSpawn(createValidRequest(), ctx);
    expect(result.error?.code).toBe("PARENT_CONTEXT_INVALID");
    expect(hoisted.spawnSubagentDirectMock).not.toHaveBeenCalled();
  });

  it("returns AGENT_NOT_FOUND when agent config is missing", async () => {
    const ctx = createMockContext({
      agentConfig: {
        async resolveAgentConfig() {
          return null;
        },
      },
    });
    const result = await directSpawn(createValidRequest(), ctx);
    expect(result.error?.code).toBe("AGENT_NOT_FOUND");
    expect(hoisted.spawnSubagentDirectMock).not.toHaveBeenCalled();
  });

  it("passes policy rejection as SPAWN_REJECTED", async () => {
    hoisted.spawnSubagentDirectMock.mockResolvedValue({
      status: "forbidden",
      error: "Agent not allowed for spawn",
    });
    const result = await directSpawn(createValidRequest(), createMockContext());
    expect(result.ok).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.error?.code).toBe("SPAWN_REJECTED");
  });

  it("returns SPAWN_ACCEPT_TIMEOUT_NO_IDENTIFIERS on accept timeout", async () => {
    hoisted.spawnSubagentDirectMock.mockImplementation(() => new Promise(() => {}));
    const result = await directSpawn(createValidRequest(), createMockContext(), {
      acceptTimeoutMs: 1,
    });
    expect(result.error?.code).toBe("SPAWN_ACCEPT_TIMEOUT_NO_IDENTIFIERS");
  });

  it("sanitizes errors from producer", async () => {
    hoisted.spawnSubagentDirectMock.mockRejectedValue(new Error("secret=abc123"));
    const result = await directSpawn(createValidRequest(), createMockContext(), {
      acceptTimeoutMs: 100,
    });
    expect(result.error?.message).not.toContain("abc123");
    expect(result.error?.code).toBe("INTERNAL_SPAWN_FAILURE_SANITIZED");
  });

  it("returns full successful identifiers", async () => {
    hoisted.spawnSubagentDirectMock.mockResolvedValue({
      status: "accepted",
      childSessionKey: "agent:worker:child-key-456",
      runId: "run-uuid-456",
    });
    const result = await directSpawn(createValidRequest(), createMockContext());
    expect(result.runId).toBe("run-uuid-456");
    expect(result.childSessionKey).toBe("agent:worker:child-key-456");
  });

  it("preserves partial identifiers", async () => {
    hoisted.spawnSubagentDirectMock.mockResolvedValue({
      status: "accepted",
      childSessionKey: "agent:worker:partial-key",
      runId: undefined,
    });
    const result = await directSpawn(createValidRequest(), createMockContext());
    expect(result.ok).toBe(true);
    expect(result.accepted).toBe(true);
    expect(result.runId).toBeNull();
    expect(result.childSessionKey).toBe("agent:worker:partial-key");
  });

  it("does not retry on producer error", async () => {
    hoisted.spawnSubagentDirectMock.mockRejectedValueOnce(new Error("fail"));
    const result = await directSpawn(createValidRequest(), createMockContext(), {
      acceptTimeoutMs: 100,
    });
    expect(hoisted.spawnSubagentDirectMock).toHaveBeenCalledTimes(1);
    expect(result.error?.code).toBe("INTERNAL_SPAWN_FAILURE_SANITIZED");
  });

  it("does not fall back on rejection", async () => {
    hoisted.spawnSubagentDirectMock.mockResolvedValue({
      status: "forbidden",
      error: "Policy rejection",
    });
    const result = await directSpawn(createValidRequest(), createMockContext());
    expect(result.accepted).toBe(false);
    expect(hoisted.spawnSubagentDirectMock).toHaveBeenCalledTimes(1);
  });

  it("produces result matching schema", async () => {
    const result = await directSpawn(createValidRequest(), createMockContext());
    expect(result.schemaVersion).toBe("1");
    expect(typeof result.ok).toBe("boolean");
    expect(typeof result.accepted).toBe("boolean");
    expect("runId" in result).toBe(true);
    expect("childSessionKey" in result).toBe(true);
    expect("error" in result).toBe(true);
  });

  it("rejects task exceeding max length", async () => {
    const request = createValidRequest();
    request.task = "x".repeat(DIRECT_SPAWN_TASK_MAX_LENGTH + 1);
    const result = await directSpawn(request, createMockContext());
    expect(result.error?.code).toBe("INVALID_REQUEST");
  });

  it("rejects label exceeding max length", async () => {
    const request = createValidRequest();
    request.label = "x".repeat(DIRECT_SPAWN_LABEL_MAX_LENGTH + 1);
    const result = await directSpawn(request, createMockContext());
    expect(result.error?.code).toBe("INVALID_REQUEST");
  });

  it("rejects childTimeoutSeconds exceeding max", async () => {
    const request = createValidRequest();
    request.childTimeoutSeconds = DIRECT_SPAWN_CHILD_TIMEOUT_SECONDS_MAX + 1;
    const result = await directSpawn(request, createMockContext());
    expect(result.error?.code).toBe("INVALID_REQUEST");
  });
});
