// Runtime image/source provenance acquisition tests.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { RuntimeProvenanceCode, resolveRuntimeImageTruth } from "./runtime-provenance.js";

const IMAGE_ID = "sha256:c9515b90811c75128d97fff1bfde9f6075201d95f9f6d759f43878c2fc81229c";
const SOURCE_COMMIT = "092549f011e2bfcbfe6ac3af4bb8423ecef7422c";
const SOURCE_TREE = "c17d48bf3368d5726beb1ff5656b00a9c3ce7a08";

describe("resolveRuntimeImageTruth", () => {
  const tempDirs = useAutoCleanupTempDirTracker(afterEach);

  function writeBuildInfo(overrides: Record<string, unknown> = {}): string {
    const dir = tempDirs.make("runtime-provenance-");
    const buildInfoPath = path.join(dir, "build-info.json");
    fs.writeFileSync(
      buildInfoPath,
      `${JSON.stringify({
        version: "2026.7.2-beta.7",
        commit: SOURCE_COMMIT,
        tree: SOURCE_TREE,
        builtAt: "2026-08-08T15:15:16.000Z",
        ...overrides,
      })}\n`,
    );
    return buildInfoPath;
  }

  it("resolves exact provenance for valid image ID + commit + tree", () => {
    const result = resolveRuntimeImageTruth({
      env: { OPENCLAW_RUNTIME_IMAGE_ID: IMAGE_ID },
      buildInfoPath: writeBuildInfo(),
    });
    expect(result).toEqual({
      ok: true,
      truth: { imageId: IMAGE_ID, sourceCommit: SOURCE_COMMIT, sourceTree: SOURCE_TREE },
    });
  });

  it("blocks when OPENCLAW_RUNTIME_IMAGE_ID is missing", () => {
    const result = resolveRuntimeImageTruth({
      env: {},
      buildInfoPath: writeBuildInfo(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(RuntimeProvenanceCode.PROVENANCE_MISSING);
    }
  });

  it("blocks on malformed image ID", () => {
    for (const bad of [
      "sha256:xyz",
      "sha256:" + "a".repeat(63),
      "c9515b90",
      "sha256:" + "g".repeat(64),
    ]) {
      const result = resolveRuntimeImageTruth({
        env: { OPENCLAW_RUNTIME_IMAGE_ID: bad },
        buildInfoPath: writeBuildInfo(),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(RuntimeProvenanceCode.PROVENANCE_MALFORMED);
      }
    }
  });

  it("blocks when build-info is missing", () => {
    const result = resolveRuntimeImageTruth({
      env: { OPENCLAW_RUNTIME_IMAGE_ID: IMAGE_ID },
      buildInfoPath: path.join(tempDirs.make("missing-"), "nope.json"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(RuntimeProvenanceCode.PROVENANCE_MISSING);
    }
  });

  it("blocks when build-info is not a plain object", () => {
    const dir = tempDirs.make("not-object-");
    const buildInfoPath = path.join(dir, "build-info.json");
    fs.writeFileSync(buildInfoPath, "[1,2,3]\n");
    const result = resolveRuntimeImageTruth({
      env: { OPENCLAW_RUNTIME_IMAGE_ID: IMAGE_ID },
      buildInfoPath,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(RuntimeProvenanceCode.PROVENANCE_MISSING);
    }
  });

  it("blocks when commit is missing", () => {
    const result = resolveRuntimeImageTruth({
      env: { OPENCLAW_RUNTIME_IMAGE_ID: IMAGE_ID },
      buildInfoPath: writeBuildInfo({ commit: null }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(RuntimeProvenanceCode.PROVENANCE_MISSING);
    }
  });

  it("blocks when tree is missing", () => {
    const result = resolveRuntimeImageTruth({
      env: { OPENCLAW_RUNTIME_IMAGE_ID: IMAGE_ID },
      buildInfoPath: writeBuildInfo({ tree: null }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(RuntimeProvenanceCode.PROVENANCE_MISSING);
    }
  });

  it("blocks on malformed commit", () => {
    const result = resolveRuntimeImageTruth({
      env: { OPENCLAW_RUNTIME_IMAGE_ID: IMAGE_ID },
      buildInfoPath: writeBuildInfo({ commit: "g".repeat(40) }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(RuntimeProvenanceCode.PROVENANCE_MALFORMED);
    }
  });

  it("blocks on malformed tree", () => {
    const result = resolveRuntimeImageTruth({
      env: { OPENCLAW_RUNTIME_IMAGE_ID: IMAGE_ID },
      buildInfoPath: writeBuildInfo({ tree: "g".repeat(40) }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(RuntimeProvenanceCode.PROVENANCE_MALFORMED);
    }
  });
});
