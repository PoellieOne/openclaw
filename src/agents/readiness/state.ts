import { ReadinessCode } from "./codes.js";
import { CONTRACT_VERSION_V2 } from "./contracts-v2.js";
import type { ProjectionPreparationAssertion } from "./contracts-v2.js";
import type { RevalidationMechanism } from "./revalidation.js";
import type {
  ReadinessRunStateData,
  ResolvedReadinessPolicy,
  ReadinessEvaluation,
} from "./types.js";

function isValidCombination(
  policy: ResolvedReadinessPolicy,
  evaluation: ReadinessEvaluation | null,
): boolean {
  if (evaluation === null) {
    return (
      policy.disposition === "REQUIRED" ||
      policy.disposition === "UNRESOLVED" ||
      policy.disposition === "EXPLICITLY_DISABLED_NON_PRODUCTION" ||
      policy.disposition === "NOT_APPLICABLE"
    );
  }
  const d = policy.disposition;
  const o = evaluation.outcome;
  if (d === "REQUIRED") return o === "EVIDENCE_READY" || o === "BLOCKED";
  if (d === "UNRESOLVED") return o === "BLOCKED";
  if (d === "EXPLICITLY_DISABLED_NON_PRODUCTION") return o === "POLICY_BYPASS_NON_PRODUCTION";
  if (d === "NOT_APPLICABLE") return o === "ROUTE_NOT_APPLICABLE";
  return false;
}

export class ReadinessRunState {
  private readonly data: ReadinessRunStateData;

  private constructor(data: ReadinessRunStateData) {
    this.data = data;
  }

  static create(params: {
    policy: ResolvedReadinessPolicy;
    evaluation: ReadinessEvaluation | null;
    projectionId?: string;
    projectionVersion?: string;
    projectionPreparation?: ProjectionPreparationAssertion;
    expectedConfigDigest?: string;
    revalidationMechanism?: RevalidationMechanism;
    now: number;
  }): ReadinessRunState {
    const evaluation = params.evaluation;
    if (!isValidCombination(params.policy, evaluation)) {
      throw new Error("Invalid readiness policy/evaluation combination");
    }
    return new ReadinessRunState({
      policy: params.policy,
      evaluation,
      projectionId: params.projectionId ?? null,
      projectionVersion: params.projectionVersion ?? null,
      projectionPreparation: params.projectionPreparation ?? null,
      expectedConfigDigest: params.expectedConfigDigest ?? null,
      revalidationMechanism: params.revalidationMechanism ?? null,
      evaluatedAt: evaluation?.evaluatedAt ?? params.now,
      classification: evaluation?.classification ?? ReadinessCode.POLICY_UNRESOLVED,
      diagnosticRef: evaluation?.diagnosticRef ?? "readiness-no-evaluation",
    });
  }

  get policy(): ResolvedReadinessPolicy {
    return this.data.policy;
  }

  get evaluation(): ReadinessEvaluation | null {
    return this.data.evaluation;
  }

  get classification(): string {
    return this.data.classification;
  }

  get diagnosticRef(): string {
    return this.data.diagnosticRef;
  }

  get evaluatedAt(): number {
    return this.data.evaluatedAt;
  }

  get projectionPreparation(): ProjectionPreparationAssertion | null {
    return this.data.projectionPreparation;
  }

  get expectedConfigDigest(): string | null {
    return this.data.expectedConfigDigest;
  }

  get revalidationMechanism(): RevalidationMechanism | null {
    return this.data.revalidationMechanism;
  }

  mayExecute(): boolean {
    if (this.data.policy.disposition === "NOT_APPLICABLE") return true;
    if (this.data.policy.disposition === "EXPLICITLY_DISABLED_NON_PRODUCTION") return true;
    if (this.data.evaluation === null) return false;
    if (this.data.policy.disposition === "REQUIRED" && this.data.evaluation.decision === "READY") {
      if (this.data.policy.contractVersion === CONTRACT_VERSION_V2) {
        if (this.data.projectionPreparation === null) return false;
        if (!this.data.projectionPreparation.ok) return false;
      }
      return true;
    }
    return false;
  }

  isBlocked(): boolean {
    return !this.mayExecute();
  }

  toBlockedResult(): {
    classification: string;
    diagnosticRef: string;
    evaluatedAt: number;
    sanitizedMessage: string;
    isBlocked: true;
  } {
    return {
      classification: this.data.classification,
      diagnosticRef: this.data.diagnosticRef,
      evaluatedAt: this.data.evaluatedAt,
      sanitizedMessage: "This action cannot be completed because a readiness check did not pass.",
      isBlocked: true,
    };
  }
}
