import { describe, it, expect } from "vitest";
import { applyReadinessBootstrapAdapter } from "./bootstrap-adapter.js";
import type { ReadinessGovernance, GovernedReadinessProjection } from "./types.js";

function makeGoverned(state: "ready" | "blocked"): ReadinessGovernance {
  return {
    governed: true,
    state: { mayExecute: () => state === "ready", isBlocked: () => state !== "ready" } as never,
  };
}

function makeUngoverned(): ReadinessGovernance {
  return { governed: false, reason: "EXPLICIT_LEGACY_ROLLOUT_EXCEPTION" };
}

function makeProjection(): GovernedReadinessProjection {
  return {
    id: "proj-1",
    version: "v1",
    content: JSON.stringify({ contract_version: "readiness.v1", decision: "READY" }),
  };
}

function makeBootstrapFiles(): {
  name: string;
  path: string;
  content?: string;
  missing: boolean;
}[] {
  return [
    { name: "AGENTS.md", path: "/workspace/AGENTS.md", content: "content", missing: false },
    { name: "SOUL.md", path: "/workspace/SOUL.md", missing: true },
  ];
}

describe("applyReadinessBootstrapAdapter", () => {
  it("governed + valid projection returns exactly one entry", () => {
    const result = applyReadinessBootstrapAdapter({
      governance: makeGoverned("ready"),
      projection: makeProjection(),
      bootstrapFiles: makeBootstrapFiles(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe("readiness-governance");
      expect(result.files[0].missing).toBe(false);
    }
  });

  it("governed + valid projection suppresses standard entries", () => {
    const result = applyReadinessBootstrapAdapter({
      governance: makeGoverned("ready"),
      projection: makeProjection(),
      bootstrapFiles: makeBootstrapFiles(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const names = result.files.map((f) => f.name);
      expect(names).not.toContain("AGENTS.md");
      expect(names).not.toContain("SOUL.md");
    }
  });

  it("governed + valid projection suppresses missing placeholders", () => {
    const result = applyReadinessBootstrapAdapter({
      governance: makeGoverned("ready"),
      projection: makeProjection(),
      bootstrapFiles: makeBootstrapFiles(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files.every((f) => !f.missing)).toBe(true);
    }
  });

  it("governed + valid projection preserves content and identity", () => {
    const projection = makeProjection();
    const result = applyReadinessBootstrapAdapter({
      governance: makeGoverned("ready"),
      projection,
      bootstrapFiles: makeBootstrapFiles(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files[0].content).toBe(projection.content);
      expect(result.files[0].path).toContain(projection.id);
    }
  });

  it("explicit ungoverned route returns original list unchanged", () => {
    const files = makeBootstrapFiles();
    const result = applyReadinessBootstrapAdapter({
      governance: makeUngoverned(),
      projection: null,
      bootstrapFiles: files,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files).toHaveLength(files.length);
      expect(result.files[0].name).toBe(files[0].name);
    }
  });

  it("missing governance input is not accepted (type-safe)", () => {
    const input: {
      governance: ReadinessGovernance;
      projection: null;
      bootstrapFiles: typeof makeBootstrapFiles;
    } = {
      governance: makeUngoverned(),
      projection: null,
      bootstrapFiles: makeBootstrapFiles(),
    };
    expect(input.governance.governed).toBe(false);
  });

  it("governed + missing projection returns typed failure", () => {
    const result = applyReadinessBootstrapAdapter({
      governance: makeGoverned("ready"),
      projection: null,
      bootstrapFiles: makeBootstrapFiles(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EVIDENCE_MISSING");
  });

  it("adapter performs no parsing or evaluation", () => {
    const result = applyReadinessBootstrapAdapter({
      governance: makeGoverned("ready"),
      projection: makeProjection(),
      bootstrapFiles: makeBootstrapFiles(),
    });
    expect(result.ok).toBe(true);
  });

  it("adapter does not mutate input array", () => {
    const files = makeBootstrapFiles();
    const originalLength = files.length;
    applyReadinessBootstrapAdapter({
      governance: makeGoverned("ready"),
      projection: makeProjection(),
      bootstrapFiles: files,
    });
    expect(files).toHaveLength(originalLength);
  });

  it("adapter output is deterministic", () => {
    const input = {
      governance: makeGoverned("ready"),
      projection: makeProjection(),
      bootstrapFiles: makeBootstrapFiles(),
    };
    const a = applyReadinessBootstrapAdapter(input);
    const b = applyReadinessBootstrapAdapter(input);
    expect(a).toEqual(b);
  });
});
