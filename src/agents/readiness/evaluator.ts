import { ReadinessCode } from "./codes.js";
import { parseReadinessJson } from "./parser.js";
import type { ResolvedReadinessPolicy, ReadinessEvaluation } from "./types.js";
import { validateReadinessContract, validateReadinessContractV2 } from "./validator.js";

export type ReadinessV2EvaluationInput = {
  expectedAgentId: string;
  expectedImageId: string;
  expectedSourceCommit: string;
  expectedSourceTree: string;
  expectedConfigDigest: string;
  expectedProviderPolicy: string;
  expectedModelPolicy: string;
  expectedAuthMethodPolicy: string;
  expectedFallbackPolicy: string;
  expectedSemanticProjectionId: string;
  expectedSemanticProjectionVersion: string;
  expectedSemanticProjectionSourceDigest: string;
  expectedSourceManifestDigest: string;
  supportedValidatorId: string;
  supportedValidatorVersion: string;
};

export function evaluateReadinessV2(
  policy: ResolvedReadinessPolicy,
  evidenceJson: string | null,
  input: ReadinessV2EvaluationInput,
  now: number,
): ReadinessEvaluation {
  if (policy.disposition === "NOT_APPLICABLE") {
    return {
      decision: "READY",
      outcome: "ROUTE_NOT_APPLICABLE",
      classification: ReadinessCode.POLICY_NOT_APPLICABLE,
      diagnosticRef: "readiness-not-applicable",
      evaluatedAt: now,
      policy,
    };
  }

  if (policy.disposition === "EXPLICITLY_DISABLED_NON_PRODUCTION") {
    return {
      decision: "READY",
      outcome: "POLICY_BYPASS_NON_PRODUCTION",
      classification: ReadinessCode.POLICY_EXPLICITLY_DISABLED_NON_PRODUCTION,
      diagnosticRef: "readiness-disabled-non-production",
      evaluatedAt: now,
      policy,
    };
  }

  if (policy.disposition === "UNRESOLVED") {
    return {
      decision: "BLOCKED",
      outcome: "BLOCKED",
      classification: policy.code ?? ReadinessCode.POLICY_UNRESOLVED,
      diagnosticRef: "readiness-unresolved",
      evaluatedAt: now,
      policy,
    };
  }

  if (policy.disposition !== "REQUIRED") {
    return {
      decision: "BLOCKED",
      outcome: "BLOCKED",
      classification: ReadinessCode.POLICY_UNRESOLVED,
      diagnosticRef: "readiness-unknown-disposition",
      evaluatedAt: now,
      policy,
    };
  }

  if (!evidenceJson || evidenceJson.trim().length === 0) {
    return {
      decision: "BLOCKED",
      outcome: "BLOCKED",
      classification: ReadinessCode.EVIDENCE_MISSING,
      diagnosticRef: "readiness-evidence-missing",
      evaluatedAt: now,
      policy,
    };
  }

  let parsed: unknown;
  try {
    const result = parseReadinessJson(evidenceJson);
    if (!result.ok) {
      return {
        decision: "BLOCKED",
        outcome: "BLOCKED",
        classification: result.code,
        diagnosticRef: `readiness-parse-error:${result.code}`,
        evaluatedAt: now,
        policy,
      };
    }
    parsed = result.value;
  } catch {
    return {
      decision: "BLOCKED",
      outcome: "BLOCKED",
      classification: ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED,
      diagnosticRef: "readiness-internal-error",
      evaluatedAt: now,
      policy,
    };
  }

  const validation = validateReadinessContractV2(parsed, {
    expectedAgentId: input.expectedAgentId,
    expectedImageId: input.expectedImageId,
    expectedSourceCommit: input.expectedSourceCommit,
    expectedSourceTree: input.expectedSourceTree,
    expectedConfigDigest: input.expectedConfigDigest,
    expectedProviderPolicy: input.expectedProviderPolicy,
    expectedModelPolicy: input.expectedModelPolicy,
    expectedAuthMethodPolicy: input.expectedAuthMethodPolicy,
    expectedFallbackPolicy: input.expectedFallbackPolicy,
    expectedSemanticProjectionId: input.expectedSemanticProjectionId,
    expectedSemanticProjectionVersion: input.expectedSemanticProjectionVersion,
    expectedSemanticProjectionSourceDigest: input.expectedSemanticProjectionSourceDigest,
    expectedSourceManifestDigest: input.expectedSourceManifestDigest,
    supportedValidatorId: input.supportedValidatorId,
    supportedValidatorVersion: input.supportedValidatorVersion,
    maximumAgeMs: policy.maximumAgeMs,
    now,
  });

  if (!validation.ok) {
    return {
      decision: "BLOCKED",
      outcome: "BLOCKED",
      classification: validation.code,
      diagnosticRef: `readiness-validation-error:${validation.code}`,
      evaluatedAt: now,
      policy,
    };
  }

  if (validation.contract.decision === "BLOCKED") {
    return {
      decision: "BLOCKED",
      outcome: "BLOCKED",
      classification: validation.contract.classification ?? ReadinessCode.POLICY_REQUIRED,
      diagnosticRef: validation.contract.diagnostic_ref ?? "readiness-contract-blocked",
      evaluatedAt: now,
      policy,
    };
  }

  return {
    decision: "READY",
    outcome: "EVIDENCE_READY",
    classification: ReadinessCode.POLICY_REQUIRED,
    diagnosticRef: "readiness-ready",
    evaluatedAt: now,
    policy,
  };
}

export function evaluateReadiness(
  policy: ResolvedReadinessPolicy,
  evidenceJson: string | null,
  projectionId: string | null,
  projectionVersion: string | null,
  now: number,
): ReadinessEvaluation {
  if (policy.disposition === "NOT_APPLICABLE") {
    return {
      decision: "READY",
      outcome: "ROUTE_NOT_APPLICABLE",
      classification: ReadinessCode.POLICY_NOT_APPLICABLE,
      diagnosticRef: "readiness-not-applicable",
      evaluatedAt: now,
      policy,
    };
  }

  if (policy.disposition === "EXPLICITLY_DISABLED_NON_PRODUCTION") {
    return {
      decision: "READY",
      outcome: "POLICY_BYPASS_NON_PRODUCTION",
      classification: ReadinessCode.POLICY_EXPLICITLY_DISABLED_NON_PRODUCTION,
      diagnosticRef: "readiness-disabled-non-production",
      evaluatedAt: now,
      policy,
    };
  }

  if (policy.disposition === "UNRESOLVED") {
    return {
      decision: "BLOCKED",
      outcome: "BLOCKED",
      classification: policy.code ?? ReadinessCode.POLICY_UNRESOLVED,
      diagnosticRef: "readiness-unresolved",
      evaluatedAt: now,
      policy,
    };
  }

  if (policy.disposition !== "REQUIRED") {
    return {
      decision: "BLOCKED",
      outcome: "BLOCKED",
      classification: ReadinessCode.POLICY_UNRESOLVED,
      diagnosticRef: "readiness-unknown-disposition",
      evaluatedAt: now,
      policy,
    };
  }

  if (!evidenceJson || evidenceJson.trim().length === 0) {
    return {
      decision: "BLOCKED",
      outcome: "BLOCKED",
      classification: ReadinessCode.EVIDENCE_MISSING,
      diagnosticRef: "readiness-evidence-missing",
      evaluatedAt: now,
      policy,
    };
  }

  let parsed: unknown;
  try {
    const result = parseReadinessJson(evidenceJson);
    if (!result.ok) {
      return {
        decision: "BLOCKED",
        outcome: "BLOCKED",
        classification: result.code,
        diagnosticRef: `readiness-parse-error:${result.code}`,
        evaluatedAt: now,
        policy,
      };
    }
    parsed = result.value;
  } catch {
    return {
      decision: "BLOCKED",
      outcome: "BLOCKED",
      classification: ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED,
      diagnosticRef: "readiness-internal-error",
      evaluatedAt: now,
      policy,
    };
  }

  const validation = validateReadinessContract(
    parsed,
    now,
    policy.maximumAgeMs,
    policy.projectionBindingRequired ? (projectionId ?? undefined) : undefined,
    policy.projectionBindingRequired ? (projectionVersion ?? undefined) : undefined,
  );

  if (!validation.ok) {
    if (validation.code === ReadinessCode.UNSUPPORTED_CONTRACT_VERSION) {
      return {
        decision: "BLOCKED",
        outcome: "BLOCKED",
        classification: ReadinessCode.UNSUPPORTED_CONTRACT_VERSION,
        diagnosticRef: "readiness-unsupported-contract-version",
        evaluatedAt: now,
        policy,
      };
    }
    return {
      decision: "BLOCKED",
      outcome: "BLOCKED",
      classification: validation.code,
      diagnosticRef: `readiness-validation-error:${validation.code}`,
      evaluatedAt: now,
      policy,
    };
  }

  if (validation.contract.decision === "BLOCKED") {
    return {
      decision: "BLOCKED",
      outcome: "BLOCKED",
      classification: validation.contract.classification ?? ReadinessCode.POLICY_REQUIRED,
      diagnosticRef: validation.contract.diagnostic_ref ?? "readiness-contract-blocked",
      evaluatedAt: now,
      policy,
    };
  }

  return {
    decision: "READY",
    outcome: "EVIDENCE_READY",
    classification: ReadinessCode.POLICY_REQUIRED,
    diagnosticRef: "readiness-ready",
    evaluatedAt: now,
    policy,
  };
}
