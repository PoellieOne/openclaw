import { MANIFEST_ID } from "./contracts-v2.js";
import type { SourceManifestReference } from "./contracts-v2.js";

const SHA256_HEX_LENGTH = 64;
const HEX_RE = /^[0-9a-f]+$/u;

export type SourceManifestReferenceResult =
  | { ok: true; reference: SourceManifestReference }
  | { ok: false; code: string; message: string };

export function validateSourceManifestReference(
  payloadManifestId: string,
  payloadManifestDigest: string,
  expectedManifestId: string,
  expectedAggregateDigest: string,
): SourceManifestReferenceResult {
  if (payloadManifestId !== expectedManifestId) {
    return { ok: false, code: "SOURCE_MANIFEST_MISMATCH", message: "source manifest id mismatch" };
  }

  if (!isExactSha256Hex(payloadManifestDigest) || !isExactSha256Hex(expectedAggregateDigest)) {
    return {
      ok: false,
      code: "SOURCE_MANIFEST_MISMATCH",
      message: "source manifest digest must be a SHA-256 hex string",
    };
  }

  if (payloadManifestDigest !== expectedAggregateDigest) {
    return {
      ok: false,
      code: "SOURCE_MANIFEST_MISMATCH",
      message: "source manifest aggregate digest mismatch",
    };
  }

  return {
    ok: true,
    reference: { manifest_id: expectedManifestId, manifest_digest: payloadManifestDigest },
  };
}

function isExactSha256Hex(value: string): boolean {
  return value.length === SHA256_HEX_LENGTH && HEX_RE.test(value);
}

export { MANIFEST_ID };
