// Codex tests cover thread config policy for the app-server run attempt lifecycle.
import type { EmbeddedRunAttemptParams } from "openclaw/plugin-sdk/agent-harness-runtime";
import { describe, expect, it } from "vitest";
import { buildCodexRuntimeThreadConfigForRun } from "./thread-requests.js";

function makeParams(overrides: Partial<EmbeddedRunAttemptParams> = {}): EmbeddedRunAttemptParams {
  return {
    provider: "codex",
    modelId: "gpt-5.4-codex",
    config: {},
    ...overrides,
  } as EmbeddedRunAttemptParams;
}

describe("buildCodexRuntimeThreadConfigForRun", () => {
  it("forces project_doc_max_bytes: 0 for governed admission regardless of bootstrapContextMode", () => {
    const config = buildCodexRuntimeThreadConfigForRun(
      makeParams({
        readinessGovernance: {
          governed: true,
          state: { mayExecute: () => true, isBlocked: () => false } as never,
        },
      }),
      undefined,
    );
    expect(config.project_doc_max_bytes).toBe(0);
  });

  it("does not force project_doc_max_bytes for explicit governed=false non-lightweight runs", () => {
    const config = buildCodexRuntimeThreadConfigForRun(
      makeParams({
        readinessGovernance: { governed: false, reason: "EXPLICIT_LEGACY_ROLLOUT_EXCEPTION" },
      }),
      undefined,
    );
    expect(config.project_doc_max_bytes).toBeUndefined();
  });

  it("does not force project_doc_max_bytes when admission is absent", () => {
    const config = buildCodexRuntimeThreadConfigForRun(makeParams(), undefined);
    expect(config.project_doc_max_bytes).toBeUndefined();
  });

  it("keeps lightweight mode project_doc_max_bytes: 0 behavior", () => {
    const config = buildCodexRuntimeThreadConfigForRun(
      makeParams({ bootstrapContextMode: "lightweight" }),
      undefined,
    );
    expect(config.project_doc_max_bytes).toBe(0);
  });
});
