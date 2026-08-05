import { ReadinessCode } from "./codes.js";
import type { BootstrapAdapterInput, BootstrapAdapterResult } from "./types.js";

export function applyReadinessBootstrapAdapter(
  input: BootstrapAdapterInput,
): BootstrapAdapterResult {
  if (input.governance.governed === false) {
    return { ok: true, files: [...input.bootstrapFiles] };
  }

  if (!input.projection) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MISSING,
      message: "governed run requires a readiness projection",
    };
  }

  const projectionEntry = {
    name: "readiness-governance" as const,
    path: `readiness://projections/${input.projection.id}`,
    content: input.projection.content,
    missing: false,
  };

  return { ok: true, files: [projectionEntry] };
}
