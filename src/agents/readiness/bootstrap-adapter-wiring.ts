import { createHash } from "node:crypto";
import { registerInternalHook } from "../../hooks/internal-hooks.js";
import type { AgentBootstrapHookContext } from "../../hooks/internal-hooks.js";
import type { WorkspaceBootstrapFile } from "../workspace.js";
import { applyReadinessBootstrapAdapter, buildInjectionAssertion } from "./bootstrap-adapter.js";
import type { ProjectionInjectionAssertion } from "./contracts-v2.js";

const GOVERNED_ENTRY_NAME = "readiness-governance" as const;

let registered = false;

export function registerGeneratedProjectionBootstrapHook(): void {
  if (registered) {
    return;
  }
  registered = true;
  registerInternalHook("agent:bootstrap", async (event) => {
    const context = event.context as AgentBootstrapHookContext;
    const runLocal = resolveRunLocalProjectionState(context);
    if (!runLocal) {
      return;
    }
    const assertion = runLocal.injection;
    if (assertion.ok) {
      return;
    }
    const adapterResult = applyReadinessBootstrapAdapter({
      governance: runLocal.governance,
      projection: runLocal.projection,
      bootstrapFiles: context.bootstrapFiles,
    });
    const injection = buildInjectionAssertion(
      adapterResult,
      runLocal.preparation.expectedProjectionDigest,
    );
    runLocal.injection = injection;
    if (adapterResult.ok) {
      context.bootstrapFiles = adapterResult.files as WorkspaceBootstrapFile[];
    }
  });
}

export function resolveRunLocalProjectionState(
  context: AgentBootstrapHookContext,
): RunLocalProjectionState | null {
  const state = (context as unknown as Record<string, unknown>).runLocalProjectionState;
  if (state && typeof state === "object") {
    return state as RunLocalProjectionState;
  }
  return null;
}

export type RunLocalProjectionState = {
  governance: import("./types.js").ReadinessGovernance;
  preparation: import("./contracts-v2.js").ProjectionPreparationAssertion;
  projection: import("./types.js").GovernedReadinessProjection | null;
  injection: ProjectionInjectionAssertion;
};

export function verifyFinalContextProjection(
  files: readonly WorkspaceBootstrapFile[],
  expectedDigest: string | null,
): ProjectionInjectionAssertion {
  const governedEntries = files.filter(
    (file) => (file as { name: string }).name === GOVERNED_ENTRY_NAME,
  );
  if (governedEntries.length === 0) {
    return {
      ok: false,
      entryCount: 0,
      entryDigest: null,
      code: "PROJECTION_INJECTION_MISSING",
    };
  }
  if (governedEntries.length > 1) {
    return {
      ok: false,
      entryCount: governedEntries.length,
      entryDigest: null,
      code: "PROJECTION_INJECTION_DUPLICATE",
    };
  }
  const entry = governedEntries[0]!;
  const entryDigest = computeSha256(entry.content ?? "");
  if (expectedDigest !== null && entryDigest !== expectedDigest) {
    return {
      ok: false,
      entryCount: 1,
      entryDigest,
      code: "PROJECTION_INJECTION_CONTENT_MISMATCH",
    };
  }
  return {
    ok: true,
    entryCount: 1,
    entryDigest,
    code: null,
  };
}

function computeSha256(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf-8")).digest("hex");
}
