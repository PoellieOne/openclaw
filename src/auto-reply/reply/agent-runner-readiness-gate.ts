import { loadCanonicalReadinessEnvelopeV2 } from "../../agents/readiness/canonical-envelope-reader.js";
import {
  SUPPORTED_VALIDATOR_ID,
  SUPPORTED_VALIDATOR_VERSION,
} from "../../agents/readiness/contracts-v2.js";
import {
  assembleGovernedRunLocalHolder,
  buildGovernedReadinessConfigSource,
  buildGovernedV2PreparationInput,
  computeGovernedExpectedConfigDigest,
} from "../../agents/readiness/production-v2-preparation.js";
import { emitRunCarrierDiagnostic } from "../../agents/readiness/run-carrier-observability.js";
import { prepareReadinessForRun } from "../../agents/readiness/run-preparation.js";
import { resolveRuntimeImageTruth } from "../../agents/readiness/runtime-provenance.js";
import type { ReadinessRouteClassification } from "../../agents/readiness/types.js";
import type { SessionEntry } from "../../config/sessions.js";
import { emitSmoke003Phase, getSmoke003ArmedRunId } from "../../logging/smoke003-observability.js";
import type { FollowupRun } from "./queue.js";

/**
 * Fresh fail-closed readiness preparation shared by the pre-branch common gate
 * and the direct/gate-less prepared-lane path. Every invocation re-evaluates
 * current runtime truth: envelope, image/source provenance, config digest and
 * session/agent bindings. Stale/pre-restart governance must never reach here;
 * callers decide reuse only for governance attached by the same run. Returns
 * true only when the run may execute; attaches readinessGovernance and
 * runLocalProjectionState on the followupRun when ready.
 */
export function prepareCommonReadinessForRun(
  followupRun: FollowupRun,
  sessionKey?: string,
  sessionEntry?: Pick<
    SessionEntry,
    "agentHarnessId" | "agentRuntimeOverride" | "modelSelectionLocked"
  >,
): boolean {
  const routeClassification: ReadinessRouteClassification = "REAL_MODEL_EXECUTION_ROUTE";
  const envelopeResult = loadCanonicalReadinessEnvelopeV2();
  const runtimeImageTruth = resolveRuntimeImageTruth();
  let v2PreparationInput: Parameters<typeof prepareReadinessForRun>[0]["v2"] | undefined;
  let effectiveExecutionBackend: Parameters<
    typeof prepareReadinessForRun
  >[0]["effectiveExecutionBackend"];
  if (envelopeResult.ok && envelopeResult.projection) {
    const configSource = buildGovernedReadinessConfigSource({
      cfg: followupRun.run.config,
      agentId: followupRun.run.agentId,
      sessionKey,
      provider: followupRun.run.provider,
      model: followupRun.run.model,
      workspaceDir: followupRun.run.workspaceDir,
      agentDir: followupRun.run.agentDir,
      sessionEntry,
      authProfileId: followupRun.run.authProfileId,
    });
    effectiveExecutionBackend = configSource.effectiveExecutionBackend;
    const expectedConfigDigest = computeGovernedExpectedConfigDigest(configSource);
    if (runtimeImageTruth.ok) {
      v2PreparationInput = buildGovernedV2PreparationInput({
        envelope: envelopeResult.envelope,
        agentId: followupRun.run.agentId,
        expectedImageId: runtimeImageTruth.truth.imageId,
        expectedSourceCommit: runtimeImageTruth.truth.sourceCommit,
        expectedSourceTree: runtimeImageTruth.truth.sourceTree,
        expectedConfigDigest,
        supportedValidatorId: SUPPORTED_VALIDATOR_ID,
        supportedValidatorVersion: SUPPORTED_VALIDATOR_VERSION,
        now: Date.now(),
      });
    }
  }
  const preparationResult = prepareReadinessForRun({
    routeClassification,
    evidenceJson: envelopeResult.ok ? envelopeResult.envelopeJson : null,
    projectionId:
      envelopeResult.ok && envelopeResult.projection ? envelopeResult.projection.id : null,
    projectionVersion:
      envelopeResult.ok && envelopeResult.projection ? envelopeResult.projection.version : null,
    now: Date.now(),
    ...(v2PreparationInput ? { v2: v2PreparationInput } : {}),
    ...(runtimeImageTruth.ok ? {} : { runtimeImageTruth }),
    ...(effectiveExecutionBackend !== undefined ? { effectiveExecutionBackend } : {}),
  });
  const smoke003RunId = getSmoke003ArmedRunId();
  if (smoke003RunId) {
    emitSmoke003Phase(smoke003RunId, "READINESS_PREP_ENTER");
    emitSmoke003Phase(smoke003RunId, "READINESS_STAGE_A_RESULT", {
      readiness: {
        ok: preparationResult.ok,
        ...(preparationResult.ok
          ? {
              governed: preparationResult.governance.governed,
              classification: preparationResult.governance.governed
                ? preparationResult.governance.state.classification
                : preparationResult.governance.reason,
            }
          : { classification: "readiness-preparation-failure" }),
      },
    });
  }
  if (!preparationResult.ok) {
    return false;
  }
  if (
    preparationResult.governance.governed === true &&
    preparationResult.governance.state.projectionPreparation != null
  ) {
    const holder = assembleGovernedRunLocalHolder({
      governance: preparationResult.governance,
      preparation: preparationResult.governance.state.projectionPreparation,
    });
    followupRun.run.runLocalProjectionState = holder.runLocalProjectionState as never;
  }
  followupRun.run.readinessGovernance = preparationResult.governance;
  const governance = preparationResult.governance;
  const governed = governance.governed === true;
  emitRunCarrierDiagnostic({
    sessionId: followupRun.run.sessionId,
    sessionKey: sessionKey ?? followupRun.run.sessionKey,
    config: followupRun.run.config,
    phase: "STAGE_A",
    governed,
    decision: governed ? governance.state.classification : governance.reason,
    mayExecute: governed ? governance.state.mayExecute() : undefined,
    hasReadinessGovernance: followupRun.run.readinessGovernance !== undefined,
    hasRunLocalProjectionState: followupRun.run.runLocalProjectionState !== undefined,
    projectionId: followupRun.run.runLocalProjectionState?.projection?.id,
    projectionDigest:
      followupRun.run.runLocalProjectionState?.preparation.expectedProjectionDigest ?? undefined,
  });
  return !(governed && !governance.state.mayExecute());
}
