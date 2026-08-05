import { ReadinessCode } from "./codes.js";
import { evaluateReadiness } from "./evaluator.js";
import { resolveReadinessPolicyInput } from "./policy-input.js";
import { resolveReadinessPolicy } from "./policy-resolver.js";
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
};

export type ReadinessPreparationResult =
  | { ok: true; governance: ReadinessGovernance }
  | { ok: false; code: string; message: string };

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

  const evaluation = evaluateReadiness(
    policy,
    input.evidenceJson,
    input.projectionId,
    input.projectionVersion,
    input.now,
  );

  const state = ReadinessRunState.create({
    policy,
    evaluation,
    projectionId: input.projectionId ?? undefined,
    projectionVersion: input.projectionVersion ?? undefined,
    now: input.now,
  });

  return { ok: true, governance: { governed: true, state } };
}
