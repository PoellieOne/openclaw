import { ReadinessCode } from "./codes.js";
import type { GovernedReadinessProjection, ProjectionLoadResult } from "./types.js";

const MAX_PROJECTION_CONTENT_BYTES = 65536;

export type ProjectionLoader = (params: { policyId?: string }) => Promise<ProjectionLoadResult>;

export async function resolveGovernedProjection(params: {
  loader: ProjectionLoader;
  policyId?: string;
  expectedContentHash?: string;
}): Promise<ProjectionLoadResult> {
  let result: ProjectionLoadResult;
  try {
    result = await params.loader({ policyId: params.policyId });
  } catch {
    return {
      ok: false,
      code: ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED,
      message: "projection loader failed",
    };
  }

  if (!result.ok) {
    return result;
  }

  const projection = result.projection;

  if (!projection.id || projection.id.trim().length === 0) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "projection id must be non-empty",
    };
  }

  if (!projection.version || projection.version.trim().length === 0) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "projection version must be non-empty",
    };
  }

  if (projection.content.length === 0) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MISSING,
      message: "projection content is empty",
    };
  }

  if (new TextEncoder().encode(projection.content).length > MAX_PROJECTION_CONTENT_BYTES) {
    return {
      ok: false,
      code: ReadinessCode.MAXIMUM_SIZE_EXCEEDED,
      message: "projection content exceeds maximum size",
    };
  }

  if (
    params.expectedContentHash !== undefined &&
    projection.contentHash !== params.expectedContentHash
  ) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "projection content hash mismatch",
    };
  }

  return { ok: true, projection };
}
