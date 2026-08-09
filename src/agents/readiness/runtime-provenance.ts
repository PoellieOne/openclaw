// Runtime image/source provenance acquisition for governed readiness.v2.
// The Docker image ID arrives as an immutable container env binding set by
// the governed deployment controller; source commit/tree originate from the
// immutable dist/build-info.json written by the build pipeline. Any missing,
// malformed, untrusted or unsupported value is a fail-closed provenance
// failure: callers must not substitute caller-supplied strings.
import fs from "node:fs";
import path from "node:path";
import { resolveOpenClawPackageRootSync } from "../../infra/openclaw-root.js";

const IMAGE_ID_RE = /^sha256:[0-9a-f]{64}$/;
const SOURCE_SHA_RE = /^[0-9a-f]{40}$/;

export const RuntimeProvenanceCode = {
  PROVENANCE_MISSING: "PROVENANCE_MISSING",
  PROVENANCE_MALFORMED: "PROVENANCE_MALFORMED",
  PROVENANCE_UNTRUSTED: "PROVENANCE_UNTRUSTED",
  PROVENANCE_UNSUPPORTED: "PROVENANCE_UNSUPPORTED",
} as const;

export type RuntimeProvenanceCode =
  (typeof RuntimeProvenanceCode)[keyof typeof RuntimeProvenanceCode];

export type RuntimeImageTruth = {
  imageId: string;
  sourceCommit: string;
  sourceTree: string;
};

export type RuntimeImageTruthResult =
  | { ok: true; truth: RuntimeImageTruth }
  | { ok: false; code: RuntimeProvenanceCode; message: string };

type BuildInfo = {
  commit?: string | null;
  tree?: string | null;
};

function isPlainBuildInfo(value: unknown): value is BuildInfo {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBuildInfo(buildInfoPath: string | undefined): BuildInfo | null {
  if (buildInfoPath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(buildInfoPath, "utf8")) as unknown;
      return isPlainBuildInfo(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  const packageRoot = resolveOpenClawPackageRootSync({ moduleUrl: import.meta.url });
  if (!packageRoot) {
    return null;
  }
  const candidates = [
    path.join(packageRoot, "dist", "build-info.json"),
    path.join(packageRoot, "build-info.json"),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as unknown;
      if (isPlainBuildInfo(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next candidate; a missing file is a provenance failure below.
    }
  }
  return null;
}

/**
 * Resolves exact runtime image/source truth for the governed production route.
 *
 * `buildInfoPath` is a test-only injection seam; production callers never
 * supply provenance strings. The image ID must come from the immutable
 * OPENCLAW_RUNTIME_IMAGE_ID container env; commit/tree must come from the
 * immutable build-info content.
 */
export function resolveRuntimeImageTruth(
  options: {
    env?: NodeJS.ProcessEnv;
    buildInfoPath?: string;
  } = {},
): RuntimeImageTruthResult {
  const env = options.env ?? process.env;
  const imageId = env.OPENCLAW_RUNTIME_IMAGE_ID?.trim();
  if (!imageId) {
    return {
      ok: false,
      code: RuntimeProvenanceCode.PROVENANCE_MISSING,
      message: "OPENCLAW_RUNTIME_IMAGE_ID is not set",
    };
  }
  if (!IMAGE_ID_RE.test(imageId)) {
    return {
      ok: false,
      code: RuntimeProvenanceCode.PROVENANCE_MALFORMED,
      message: "OPENCLAW_RUNTIME_IMAGE_ID must match ^sha256:[0-9a-f]{64}$",
    };
  }
  const buildInfo = readBuildInfo(options.buildInfoPath);
  if (buildInfo === null) {
    const packageRoot = resolveOpenClawPackageRootSync({ moduleUrl: import.meta.url });
    if (!packageRoot && !options.buildInfoPath) {
      return {
        ok: false,
        code: RuntimeProvenanceCode.PROVENANCE_UNSUPPORTED,
        message: "runtime cannot locate the immutable build-info provenance",
      };
    }
    return {
      ok: false,
      code: RuntimeProvenanceCode.PROVENANCE_MISSING,
      message: "build-info.json is missing or not a plain object",
    };
  }
  const commit = typeof buildInfo.commit === "string" ? buildInfo.commit.trim() : "";
  const tree = typeof buildInfo.tree === "string" ? buildInfo.tree.trim() : "";
  if (!commit) {
    return {
      ok: false,
      code: RuntimeProvenanceCode.PROVENANCE_MISSING,
      message: "build-info.json commit is missing",
    };
  }
  if (!tree) {
    return {
      ok: false,
      code: RuntimeProvenanceCode.PROVENANCE_MISSING,
      message: "build-info.json tree is missing",
    };
  }
  if (!SOURCE_SHA_RE.test(commit)) {
    return {
      ok: false,
      code: RuntimeProvenanceCode.PROVENANCE_MALFORMED,
      message: "build-info.json commit must be 40 lowercase hexadecimal characters",
    };
  }
  if (!SOURCE_SHA_RE.test(tree)) {
    return {
      ok: false,
      code: RuntimeProvenanceCode.PROVENANCE_MALFORMED,
      message: "build-info.json tree must be 40 lowercase hexadecimal characters",
    };
  }
  return {
    ok: true,
    truth: { imageId, sourceCommit: commit, sourceTree: tree },
  };
}
