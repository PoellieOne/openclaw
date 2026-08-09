import { ReadinessCode } from "./codes.js";
import { computeReadinessConfigDigest } from "./config-digest.js";
import type { ReadinessConfigProjectionInput } from "./config-digest.js";
import type { ProjectionPreparationAssertion } from "./contracts-v2.js";
import { evaluateReadiness, evaluateReadinessV2 } from "./evaluator.js";
import type { ReadinessV2EvaluationInput } from "./evaluator.js";
import { evaluateExecutionBackendPolicy } from "./execution-backend.js";
import { loadGeneratedProjectionPayload } from "./payload-reader.js";
import { resolveReadinessPolicyInput } from "./policy-input.js";
import { resolveReadinessPolicy } from "./policy-resolver.js";
import { RevalidationTrigger } from "./revalidation.js";
import type { RevalidationMechanism } from "./revalidation.js";
import { resolveRevalidationMechanism } from "./revalidation.js";
import type { RuntimeImageTruthResult } from "./runtime-provenance.js";
import { ReadinessRunState } from "./state.js";
import type {
  ReadinessGovernance,
  ReadinessRouteClassification,
  ResolvedReadinessPolicy,
} from "./types.js";

export type ReadinessPreparationInput = {
  routeClassification: ReadinessRouteClassification;
  evidenceJson: string | null;
  projectionId: string | null;
  projectionVersion: string | null;
  isTestHarness?: boolean;
  now: number;
  revalidationTrigger?: RevalidationTrigger;
  v2?: {
    payloadPath: string;
    expectedPayloadId: string;
    expectedPayloadVersion: string;
    expectedSha256: string;
    expectedBytecount: number;
    expectedSemanticProjectionId: string;
    expectedSemanticProjectionVersion: string;
    expectedSemanticProjectionSourceDigest: string;
    expectedSourceManifestDigest: string;
    validation: ReadinessV2EvaluationInput;
  };
  /** Resolved runtime image/source provenance for the governed production route. */
  runtimeImageTruth?: RuntimeImageTruthResult;
  config?: ReadinessConfigProjectionInput;
  /** Effective execution backend resolved from the same runtime truth as useCliExecution. */
  effectiveExecutionBackend?: import("./execution-backend.js").ExecutionBackendPolicyEvaluation["effectiveBackend"];
};

export type ReadinessPreparationResult =
  | { ok: true; governance: ReadinessGovernance }
  | { ok: false; code: string; message: string };

function buildPreparationAssertion(
  payloadPath: string,
  expectedPayloadId: string,
  expectedPayloadVersion: string,
  expectedSha256: string,
  expectedBytecount: number,
  expectedSemanticProjectionId: string,
  expectedSemanticProjectionVersion: string,
  expectedSemanticProjectionSourceDigest: string,
  expectedSourceManifestDigest: string,
): ProjectionPreparationAssertion {
  const payloadResult = loadGeneratedProjectionPayload({
    path: payloadPath,
    expectedPayloadId,
    expectedPayloadVersion,
    expectedSha256,
    expectedBytecount,
    expectedSemanticProjectionId,
    expectedSemanticProjectionVersion,
    expectedSemanticProjectionSourceDigest,
    expectedSourceManifestDigest,
  });
  if (!payloadResult.ok) {
    return {
      ok: false,
      payloadId: null,
      payloadVersion: null,
      expectedProjectionDigest: null,
      expectedBytecount: null,
      payloadContent: null,
      code: payloadResult.code,
    };
  }
  return {
    ok: true,
    payloadId: payloadResult.payload.payload_id,
    payloadVersion: payloadResult.payload.payload_version,
    expectedProjectionDigest: payloadResult.sha256,
    expectedBytecount: payloadResult.bytecount,
    payloadContent: new TextDecoder("utf-8", { fatal: true }).decode(payloadResult.payloadBytes),
    code: null,
  };
}

export function prepareReadinessForRun(
  input: ReadinessPreparationInput,
): ReadinessPreparationResult {
  const policyInput = resolveReadinessPolicyInput({
    routeClassification: input.routeClassification,
    isTestHarness: input.isTestHarness,
    now: input.now,
  });

  const policy: ResolvedReadinessPolicy = resolveReadinessPolicy(policyInput);

  if (policy.disposition === "NOT_APPLICABLE") {
    return {
      ok: true,
      governance: { governed: false, reason: "TRUSTED_NON_MODEL_ROUTE" },
    };
  }

  // Execution-backend policy gate: the governed production route allows only
  // the OpenClaw embedded provider runtime. A CLI backend resolved from the
  // same runtime truth that selects useCliExecution is a pre-dispatch
  // EXECUTION_BACKEND_POLICY_VIOLATION with zero provider/CLI invocation.
  if (input.effectiveExecutionBackend !== undefined) {
    const backendEvaluation = evaluateExecutionBackendPolicy(input.effectiveExecutionBackend);
    if (!backendEvaluation.ok) {
      const state = ReadinessRunState.create({
        policy,
        evaluation: {
          decision: "BLOCKED",
          outcome: "BLOCKED",
          classification: backendEvaluation.classification,
          diagnosticRef: backendEvaluation.diagnosticRef,
          evaluatedAt: input.now,
          policy,
        },
        now: input.now,
      });
      return { ok: true, governance: { governed: true, state } };
    }
  }

  if (policy.disposition === "EXPLICITLY_DISABLED_NON_PRODUCTION") {
    const evaluation = evaluateReadiness(policy, null, null, null, input.now);
    const state = ReadinessRunState.create({
      policy,
      evaluation,
      projectionId: input.projectionId ?? undefined,
      projectionVersion: input.projectionVersion ?? undefined,
      now: input.now,
    });
    return { ok: true, governance: { governed: true, state } };
  }

  if (policy.disposition === "UNRESOLVED") {
    const evaluation = evaluateReadiness(policy, null, null, null, input.now);
    const state = ReadinessRunState.create({
      policy,
      evaluation,
      projectionId: input.projectionId ?? undefined,
      projectionVersion: input.projectionVersion ?? undefined,
      now: input.now,
    });
    return { ok: true, governance: { governed: true, state } };
  }

  if (policy.disposition !== "REQUIRED") {
    return {
      ok: false,
      code: ReadinessCode.POLICY_UNRESOLVED,
      message: "unknown policy disposition",
    };
  }

  // Runtime-truth gate: the governed production route requires exact resolved
  // image/source provenance. Missing/malformed/untrusted/unsupported values
  // fail closed before any envelope evaluation or provider dispatch.
  if (input.runtimeImageTruth !== undefined && !input.runtimeImageTruth.ok) {
    const state = ReadinessRunState.create({
      policy,
      evaluation: {
        decision: "BLOCKED",
        outcome: "BLOCKED",
        classification: input.runtimeImageTruth.code,
        diagnosticRef: "runtime-provenance-unresolved",
        evaluatedAt: input.now,
        policy,
      },
      now: input.now,
    });
    return { ok: true, governance: { governed: true, state } };
  }

  let preparationAssertion: ProjectionPreparationAssertion | undefined;
  let evaluation: ReturnType<typeof evaluateReadiness>;
  let expectedConfigDigest: string | undefined;
  let revalidationMechanism: RevalidationMechanism | undefined;
  if (input.v2) {
    if (input.config) {
      expectedConfigDigest = computeReadinessConfigDigest(input.config).sha256;
    }
    preparationAssertion = buildPreparationAssertion(
      input.v2.payloadPath,
      input.v2.expectedPayloadId,
      input.v2.expectedPayloadVersion,
      input.v2.expectedSha256,
      input.v2.expectedBytecount,
      input.v2.expectedSemanticProjectionId,
      input.v2.expectedSemanticProjectionVersion,
      input.v2.expectedSemanticProjectionSourceDigest,
      input.v2.expectedSourceManifestDigest,
    );
    evaluation = evaluateReadinessV2(
      policy,
      input.evidenceJson,
      {
        ...input.v2.validation,
        ...(expectedConfigDigest !== undefined ? { expectedConfigDigest } : {}),
      },
      input.now,
    );
  } else {
    evaluation = evaluateReadiness(
      policy,
      input.evidenceJson,
      input.projectionId,
      input.projectionVersion,
      input.now,
    );
  }

  if (input.revalidationTrigger !== undefined) {
    revalidationMechanism = resolveRevalidationMechanism(input.revalidationTrigger).mechanism;
  }

  const state = ReadinessRunState.create({
    policy,
    evaluation,
    projectionId: input.projectionId ?? undefined,
    projectionVersion: input.projectionVersion ?? undefined,
    projectionPreparation: preparationAssertion,
    expectedConfigDigest,
    revalidationMechanism,
    now: input.now,
  });

  return { ok: true, governance: { governed: true, state } };
}
