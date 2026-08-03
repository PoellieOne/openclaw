import type { BlockedRuntimeResult } from "./types.js";

const MAX_SANITIZED_MESSAGE_LENGTH = 1024;

export function createBlockedResult(params: {
  classification: string;
  diagnosticRef: string;
  evaluatedAt: number;
  customMessage?: string;
}): BlockedRuntimeResult {
  const message =
    params.customMessage ??
    "This action cannot be completed because a readiness check did not pass.";
  const truncated =
    message.length > MAX_SANITIZED_MESSAGE_LENGTH
      ? message.slice(0, MAX_SANITIZED_MESSAGE_LENGTH)
      : message;

  return {
    classification: params.classification,
    diagnosticRef: params.diagnosticRef,
    evaluatedAt: params.evaluatedAt,
    sanitizedMessage: truncated,
    isBlocked: true,
  };
}

export function renderBlockedResult(result: BlockedRuntimeResult): string {
  return result.sanitizedMessage;
}

export function isBlockedResult(value: unknown): value is BlockedRuntimeResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as BlockedRuntimeResult).isBlocked === true
  );
}
