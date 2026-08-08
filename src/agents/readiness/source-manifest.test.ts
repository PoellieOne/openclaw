import { describe, it, expect } from "vitest";
import { MANIFEST_ID, validateSourceManifestReference } from "./source-manifest.js";

const DIGEST = "d".repeat(64);

describe("validateSourceManifestReference", () => {
  it("passes for correct manifest id and digest", () => {
    const result = validateSourceManifestReference(MANIFEST_ID, DIGEST, MANIFEST_ID, DIGEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reference.manifest_id).toBe(MANIFEST_ID);
      expect(result.reference.manifest_digest).toBe(DIGEST);
    }
  });

  it("fails closed for wrong manifest id", () => {
    const result = validateSourceManifestReference(
      "other-manifest.v1",
      DIGEST,
      MANIFEST_ID,
      DIGEST,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SOURCE_MANIFEST_MISMATCH");
  });

  it("fails closed for wrong digest", () => {
    const result = validateSourceManifestReference(
      MANIFEST_ID,
      DIGEST,
      MANIFEST_ID,
      "e".repeat(64),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SOURCE_MANIFEST_MISMATCH");
  });

  it("fails closed for non-hex digest", () => {
    const result = validateSourceManifestReference(
      MANIFEST_ID,
      DIGEST,
      MANIFEST_ID,
      "g".repeat(64),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SOURCE_MANIFEST_MISMATCH");
  });

  it("fails closed for wrong digest length", () => {
    const result = validateSourceManifestReference(
      MANIFEST_ID,
      DIGEST,
      MANIFEST_ID,
      "d".repeat(63),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SOURCE_MANIFEST_MISMATCH");
  });

  it("fails closed for uppercase hex", () => {
    const result = validateSourceManifestReference(
      MANIFEST_ID,
      DIGEST.toUpperCase(),
      MANIFEST_ID,
      DIGEST,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SOURCE_MANIFEST_MISMATCH");
  });
});
