import { ReadinessCode } from "./codes.js";
import { CONTRACT_VERSION_V2 } from "./contracts-v2.js";
import type { GovernedReadinessProjection, ProjectionLoadResult } from "./types.js";

const MAX_PROJECTION_CONTENT_BYTES = 65536;

export type ProjectionLoader = (params: { policyId?: string }) => Promise<ProjectionLoadResult>;

export function createReadinessProjectionLoader(params: {
  evidenceJson: string;
}): ProjectionLoader {
  return async (_loaderParams?: { policyId?: string }): Promise<ProjectionLoadResult> => {
    try {
      const parsed = JSON.parse(params.evidenceJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {
          ok: false,
          code: ReadinessCode.EVIDENCE_MALFORMED,
          message: "evidence must be a JSON object",
        };
      }
      const record = parsed as Record<string, unknown>;
      if (record.contract_version === CONTRACT_VERSION_V2) {
        return {
          ok: false,
          code: ReadinessCode.UNSUPPORTED_CONTRACT_VERSION,
          message: "readiness.v2 production route must not use the in-memory evidence projection",
        };
      }
      const projectionId = typeof record.projection_id === "string" ? record.projection_id : "";
      const projectionVersion =
        typeof record.projection_version === "string" ? record.projection_version : "";
      const content = params.evidenceJson;
      if (new TextEncoder().encode(content).length > MAX_PROJECTION_CONTENT_BYTES) {
        return {
          ok: false,
          code: ReadinessCode.MAXIMUM_SIZE_EXCEEDED,
          message: "projection content exceeds maximum size",
        };
      }
      const projection: GovernedReadinessProjection = {
        id: projectionId,
        version: projectionVersion,
        content,
      };
      return { ok: true, projection };
    } catch {
      return {
        ok: false,
        code: ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED,
        message: "projection loader failed",
      };
    }
  };
}
