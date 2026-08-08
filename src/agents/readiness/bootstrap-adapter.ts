import { createHash } from "node:crypto";
import { ReadinessCode } from "./codes.js";
import { ProjectionInjectionCode } from "./contracts-v2.js";
import type { ProjectionInjectionAssertion } from "./contracts-v2.js";
import type { BootstrapAdapterInput, BootstrapAdapterResult } from "./types.js";

const GOVERNED_ENTRY_NAME = "readiness-governance" as const;

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

  const existingGoverned = input.bootstrapFiles.filter((file) => file.name === GOVERNED_ENTRY_NAME);
  if (existingGoverned.length > 1) {
    return {
      ok: false,
      code: ProjectionInjectionCode.DUPLICATE,
      message: "multiple governed projection entries present",
    };
  }
  if (existingGoverned.length === 1) {
    const existing = existingGoverned[0]!;
    const existingDigest = computeSha256(existing.content ?? "");
    const expectedDigest = computeSha256(input.projection.content);
    if (existingDigest !== expectedDigest) {
      return {
        ok: false,
        code: ProjectionInjectionCode.CONTENT_MISMATCH,
        message: "conflicting governed projection entry present",
      };
    }
  }

  const projectionEntry = {
    name: GOVERNED_ENTRY_NAME,
    path: `readiness://projections/${input.projection.id}`,
    content: input.projection.content,
    missing: false,
  };

  return { ok: true, files: [projectionEntry] };
}

export function buildInjectionAssertion(
  adapterResult: BootstrapAdapterResult,
  expectedProjectionDigest: string | null,
): ProjectionInjectionAssertion {
  if (!adapterResult.ok) {
    return {
      ok: false,
      entryCount: 0,
      entryDigest: null,
      code: ProjectionInjectionCode.FAILED,
    };
  }
  const governedEntries = adapterResult.files.filter((file) => file.name === GOVERNED_ENTRY_NAME);
  if (governedEntries.length === 0) {
    return {
      ok: false,
      entryCount: 0,
      entryDigest: null,
      code: ProjectionInjectionCode.MISSING,
    };
  }
  if (governedEntries.length > 1) {
    return {
      ok: false,
      entryCount: governedEntries.length,
      entryDigest: null,
      code: ProjectionInjectionCode.DUPLICATE,
    };
  }
  const entry = governedEntries[0]!;
  const entryDigest = computeSha256(entry.content ?? "");
  if (expectedProjectionDigest !== null && entryDigest !== expectedProjectionDigest) {
    return {
      ok: false,
      entryCount: 1,
      entryDigest,
      code: ProjectionInjectionCode.CONTENT_MISMATCH,
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
