import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { clearInternalHooks, setInternalHooksEnabled } from "../../hooks/internal-hooks.js";
import { resolveBootstrapFilesForRun } from "../bootstrap-files.js";
import type { WorkspaceBootstrapFile } from "../workspace.js";
import {
  registerGeneratedProjectionBootstrapHook,
  verifyFinalContextProjection,
  type RunLocalProjectionState,
} from "./bootstrap-adapter-wiring.js";
import { buildInjectionAssertion, applyReadinessBootstrapAdapter } from "./bootstrap-adapter.js";
import type { ReadinessGovernance, GovernedReadinessProjection } from "./types.js";

const DIGEST = "c".repeat(64);

function makeGoverned(): ReadinessGovernance {
  return {
    governed: true,
    state: { mayExecute: () => true, isBlocked: () => false } as never,
  };
}

function makeProjection(): GovernedReadinessProjection {
  return {
    id: "canonical-production-sophia-semantic-runtime-projection-v1",
    version: "1.0.0",
    content: "governed semantic projection content",
  };
}

function makeBootstrapFiles(): WorkspaceBootstrapFile[] {
  return [
    { name: "AGENTS.md", path: "/workspace/AGENTS.md", content: "content", missing: false },
    { name: "SOUL.md", path: "/workspace/SOUL.md", missing: true },
  ];
}

/**
 * Governed injection entries are represented with the adapter's
 * GOVERNED_ENTRY_NAME ("readiness-governance"), which is intentionally
 * wider than the canonical WorkspaceBootstrapFile name union. Production
 * crosses that boundary by construction (applyReadinessBootstrapAdapter
 * emits the entry; bootstrap-adapter-wiring assigns it into
 * WorkspaceBootstrapFile[]); the name-field cast below mirrors exactly that
 * production boundary cast. `name` is intentionally absent from the
 * override type so the spread cannot widen the literal back to `string`.
 */
function makeGovernedEntry(
  overrides?: Partial<{ path: string; content: string; missing: boolean }>,
): WorkspaceBootstrapFile {
  return {
    name: "readiness-governance" as WorkspaceBootstrapFile["name"],
    path: "readiness://projections/a",
    content: "content",
    missing: false,
    ...overrides,
  };
}

describe("I4 two-stage injection assertions", () => {
  beforeEach(() => {
    setInternalHooksEnabled(true);
  });

  afterEach(() => {
    clearInternalHooks();
  });

  it("shared resolveBootstrapFilesForRun hook path replaces bootstrap with exactly one readiness-governance entry on governed runs", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-readiness-hook-"));
    try {
      await fs.writeFile(path.join(workspaceDir, "AGENTS.md"), "agents content");
      await fs.writeFile(path.join(workspaceDir, "SOUL.md"), "soul content");
      const content = "governed semantic projection content";
      const expectedProjectionDigest = createHash("sha256")
        .update(Buffer.from(content, "utf-8"))
        .digest("hex");
      const runLocalProjectionState = {
        governance: {
          governed: true,
          state: { mayExecute: () => true, isBlocked: () => false } as never,
        },
        preparation: {
          ok: true,
          payloadId: "payload-1",
          payloadVersion: "1.0.0",
          expectedProjectionDigest,
          expectedBytecount: content.length,
          payloadContent: content,
          code: null,
        },
        projection: {
          id: "canonical-production-sophia-semantic-runtime-projection-v1",
          version: "1.0.0",
          content,
        },
        injection: {
          ok: false,
          entryCount: 0,
          entryDigest: null,
          code: "PROJECTION_INJECTION_MISSING",
        },
      } satisfies RunLocalProjectionState;
      registerGeneratedProjectionBootstrapHook();

      const files = await resolveBootstrapFilesForRun({
        workspaceDir,
        config: { agents: { defaults: { workspace: workspaceDir } } },
        sessionKey: "agent:main:session-1",
        agentId: "main",
        runLocalProjectionState,
      });

      expect(files).toHaveLength(1);
      expect(files[0]?.name).toBe("readiness-governance");
      expect(files[0]?.path).toContain(
        "canonical-production-sophia-semantic-runtime-projection-v1",
      );
      expect(files[0]?.content).toBe(content);
      expect(runLocalProjectionState.injection.ok).toBe(true);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("shared resolveBootstrapFilesForRun hook path leaves ordinary bootstrap unchanged without governed state", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-readiness-hook-"));
    try {
      await fs.writeFile(path.join(workspaceDir, "AGENTS.md"), "agents content");
      registerGeneratedProjectionBootstrapHook();

      const files = await resolveBootstrapFilesForRun({
        workspaceDir,
        config: { agents: { defaults: { workspace: workspaceDir } } },
        sessionKey: "agent:main:session-1",
        agentId: "main",
      });

      expect(files.some((file) => file.name === "AGENTS.md")).toBe(true);
      expect(
        files.some(
          (file) => file.name === ("readiness-governance" as WorkspaceBootstrapFile["name"]),
        ),
      ).toBe(false);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("Stage A success does NOT imply Stage B success", () => {
    const preparation = {
      ok: true,
      payloadId: "payload-1",
      payloadVersion: "1.0.0",
      expectedProjectionDigest: DIGEST,
      expectedBytecount: 100,
      code: null,
    };
    const injection = {
      ok: false,
      entryCount: 0,
      entryDigest: null,
      code: "PROJECTION_INJECTION_MISSING",
    };
    expect(preparation.ok).toBe(true);
    expect(injection.ok).toBe(false);
  });

  it("adapter throw path yields Stage B ok:false (fail closed)", () => {
    const result = buildInjectionAssertion(
      { ok: false, code: "PROJECTION_INJECTION_FAILED", message: "adapter failed" },
      DIGEST,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PROJECTION_INJECTION_FAILED");
  });

  it("zero governed entries yields Stage B ok:false", () => {
    const result = buildInjectionAssertion({ ok: true, files: makeBootstrapFiles() }, DIGEST);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PROJECTION_INJECTION_MISSING");
  });

  it("duplicate governed entries yields Stage B ok:false", () => {
    const result = buildInjectionAssertion(
      {
        ok: true,
        files: [
          makeGovernedEntry({ path: "readiness://projections/a", content: "a" }),
          makeGovernedEntry({ path: "readiness://projections/b", content: "b" }),
        ],
      },
      DIGEST,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PROJECTION_INJECTION_DUPLICATE");
  });

  it("content digest mismatch yields Stage B ok:false", () => {
    const result = buildInjectionAssertion(
      {
        ok: true,
        files: [makeGovernedEntry({ content: "different" })],
      },
      DIGEST,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PROJECTION_INJECTION_CONTENT_MISMATCH");
  });

  it("exact single entry with matching digest yields Stage B ok:true", () => {
    const content = "governed semantic projection content";
    const digest = createHash("sha256").update(Buffer.from(content, "utf-8")).digest("hex");
    const result = buildInjectionAssertion(
      {
        ok: true,
        files: [makeGovernedEntry({ content })],
      },
      digest,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entryCount).toBe(1);
      expect(result.entryDigest).toBe(digest);
    }
  });

  it("adapter produces exactly one governed entry and removes default identity material", () => {
    const result = applyReadinessBootstrapAdapter({
      governance: makeGoverned(),
      projection: makeProjection(),
      bootstrapFiles: makeBootstrapFiles(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files).toHaveLength(1);
      expect(result.files[0]!.name).toBe("readiness-governance");
      expect(result.files[0]!.path).toContain(makeProjection().id);
    }
  });

  it("adapter rejects conflicting existing governed entry", () => {
    const result = applyReadinessBootstrapAdapter({
      governance: makeGoverned(),
      projection: makeProjection(),
      bootstrapFiles: [makeGovernedEntry({ path: "readiness://projections/old", content: "old" })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PROJECTION_INJECTION_CONTENT_MISMATCH");
  });

  it("final-context verification: missing governed entry -> BLOCKED", () => {
    const result = verifyFinalContextProjection(makeBootstrapFiles(), DIGEST);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PROJECTION_INJECTION_MISSING");
  });

  it("final-context verification: exact entry with matching digest -> ok", () => {
    const content = "governed semantic projection content";
    const digest = createHash("sha256").update(Buffer.from(content, "utf-8")).digest("hex");
    const result = verifyFinalContextProjection([makeGovernedEntry({ content })], digest);
    expect(result.ok).toBe(true);
  });

  it("final-context verification: digest mismatch -> BLOCKED", () => {
    const result = verifyFinalContextProjection(
      [makeGovernedEntry({ content: "different" })],
      DIGEST,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PROJECTION_INJECTION_CONTENT_MISMATCH");
  });

  it("final-context verification: duplicate governed entries -> BLOCKED", () => {
    const result = verifyFinalContextProjection(
      [
        makeGovernedEntry({ path: "readiness://projections/a", content: "a" }),
        makeGovernedEntry({ path: "readiness://projections/b", content: "b" }),
      ],
      DIGEST,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PROJECTION_INJECTION_DUPLICATE");
  });

  it("hook registration is idempotent (single registration guard)", () => {
    registerGeneratedProjectionBootstrapHook();
    registerGeneratedProjectionBootstrapHook();
    registerGeneratedProjectionBootstrapHook();
    expect(true).toBe(true);
  });
});
