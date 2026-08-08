import { isEmbeddedMode } from "../../../infra/embedded-mode.js";
import {
  analyzeBootstrapBudget,
  buildBootstrapInjectionStats,
  buildBootstrapPromptWarning,
} from "../../bootstrap-budget.js";
import {
  buildBootstrapContextForFiles,
  hasCompletedBootstrapTurn,
  makeBootstrapWarn,
  resolveBootstrapFilesForRun,
  resolveContextInjectionMode,
} from "../../bootstrap-files.js";
import { isHeartbeatLifecycleRunKind } from "../../bootstrap-mode.js";
import {
  isPrimaryBootstrapRun,
  resolveWorkspaceBootstrapRouting,
} from "../../bootstrap-routing.js";
import {
  resolveBootstrapMaxChars,
  resolveBootstrapPromptTruncationWarningMode,
  resolveBootstrapTotalMaxChars,
} from "../../embedded-agent-helpers.js";
import { verifyFinalContextProjection } from "../../readiness/bootstrap-adapter-wiring.js";
import {
  DEFAULT_BOOTSTRAP_FILENAME,
  isWorkspaceBootstrapPending,
  type WorkspaceBootstrapFile,
} from "../../workspace.js";
import { log } from "../logger.js";
import { remapInjectedContextFilesToWorkspace } from "./attempt.bootstrap-context.js";
import { resolveAttemptBootstrapContext } from "./attempt.context-engine-helpers.js";
import type { EmbeddedRunAttemptParams } from "./types.js";

/** Stage-B final-context verification result carried on the attempt holder. */
export type StageBVerification = {
  ok: boolean;
  code: string | null;
  entryCount: number;
  entryDigest: string | null;
  expectedDigest: string | null;
};

export async function prepareEmbeddedAttemptBootstrap(params: {
  attempt: EmbeddedRunAttemptParams;
  effectiveWorkspace: string;
  hasReadTool: boolean;
  isRawModelRun: boolean;
  markStage: (name: string) => void;
  resolvedWorkspace: string;
  sessionAgentId: string;
  sessionLabel: string;
}) {
  const { attempt } = params;
  const suppressAmbientContext =
    params.isRawModelRun || attempt.operation === "settled-tool-finalization";
  const contextInjectionMode = resolveContextInjectionMode(attempt.config, params.sessionAgentId);
  const bootstrapWarn = makeBootstrapWarn({
    sessionLabel: params.sessionLabel,
    workspaceDir: params.resolvedWorkspace,
    warn: (message) => log.warn(message),
  });
  let completedBootstrapTurn: boolean | undefined;
  const hasCompletedBootstrapTurnForAttempt = async (sessionFile: string) => {
    completedBootstrapTurn ??= await hasCompletedBootstrapTurn(sessionFile);
    return completedBootstrapTurn;
  };
  const resolveBootstrapRouting = (bootstrapFiles?: readonly WorkspaceBootstrapFile[]) =>
    resolveWorkspaceBootstrapRouting({
      isWorkspaceBootstrapPending,
      bootstrapFiles,
      bootstrapContextRunKind: attempt.bootstrapContextRunKind,
      trigger: attempt.trigger,
      sessionKey: attempt.sessionKey,
      isPrimaryRun: isPrimaryBootstrapRun(attempt.sessionKey),
      isCanonicalWorkspace: attempt.isCanonicalWorkspace,
      effectiveWorkspace: params.effectiveWorkspace,
      resolvedWorkspace: params.resolvedWorkspace,
      hasBootstrapFileAccess: params.hasReadTool,
    });
  const shouldProbeContinuationSkip =
    !suppressAmbientContext &&
    contextInjectionMode === "continuation-skip" &&
    !isHeartbeatLifecycleRunKind(attempt.bootstrapContextRunKind) &&
    (await hasCompletedBootstrapTurnForAttempt(attempt.sessionFile));
  let preloadedBootstrapFiles: WorkspaceBootstrapFile[] | undefined;
  let bootstrapRouting =
    shouldProbeContinuationSkip || suppressAmbientContext || contextInjectionMode === "never"
      ? await resolveBootstrapRouting()
      : undefined;
  if (
    !suppressAmbientContext &&
    contextInjectionMode !== "never" &&
    (bootstrapRouting === undefined || bootstrapRouting.bootstrapMode === "full")
  ) {
    preloadedBootstrapFiles = await resolveBootstrapFilesForRun({
      workspaceDir: params.resolvedWorkspace,
      config: attempt.config,
      sessionKey: attempt.sessionKey,
      sessionId: attempt.sessionId,
      agentId: params.sessionAgentId,
      warn: bootstrapWarn,
      contextMode: attempt.bootstrapContextMode,
      runKind: attempt.bootstrapContextRunKind,
    });
    bootstrapRouting = await resolveBootstrapRouting(preloadedBootstrapFiles);
  }
  bootstrapRouting ??= await resolveBootstrapRouting(preloadedBootstrapFiles);
  const bootstrapMode = bootstrapRouting.bootstrapMode;
  const {
    bootstrapFiles: hookAdjustedBootstrapFiles,
    contextFiles: resolvedContextFiles,
    shouldRecordCompletedBootstrapTurn,
  } = await resolveAttemptBootstrapContext({
    // Raw probes and isolated finalization must not load AGENTS/BOOTSTRAP
    // context even though finalization preserves the settled transcript.
    contextInjectionMode: suppressAmbientContext ? "never" : contextInjectionMode,
    bootstrapContextMode: attempt.bootstrapContextMode,
    bootstrapContextRunKind: attempt.bootstrapContextRunKind ?? "default",
    bootstrapMode,
    sessionFile: attempt.sessionFile,
    hasCompletedBootstrapTurn: hasCompletedBootstrapTurnForAttempt,
    resolveBootstrapContextForRun: async () => {
      const bootstrapFiles =
        preloadedBootstrapFiles ??
        (await resolveBootstrapFilesForRun({
          workspaceDir: params.resolvedWorkspace,
          config: attempt.config,
          sessionKey: attempt.sessionKey,
          sessionId: attempt.sessionId,
          agentId: params.sessionAgentId,
          warn: bootstrapWarn,
          contextMode: attempt.bootstrapContextMode,
          runKind: attempt.bootstrapContextRunKind,
          runLocalProjectionState: attempt.runLocalProjectionState,
        }));
      return {
        bootstrapFiles,
        contextFiles: buildBootstrapContextForFiles(bootstrapFiles, {
          config: attempt.config,
          agentId: params.sessionAgentId,
          warn: bootstrapWarn,
        }),
      };
    },
  });
  params.markStage("bootstrap-context");
  const stageB = resolveStageBForAttempt({
    runLocalProjectionState: attempt.runLocalProjectionState,
    hookAdjustedBootstrapFiles,
  });
  const remappedContextFiles = remapInjectedContextFilesToWorkspace({
    files: resolvedContextFiles,
    sourceWorkspaceDir: params.resolvedWorkspace,
    targetWorkspaceDir: params.effectiveWorkspace,
  });
  const contextFiles = bootstrapRouting.includeBootstrapInSystemContext
    ? remappedContextFiles
    : remappedContextFiles.filter((file) => !/(^|[\\/])BOOTSTRAP\.md$/iu.test(file.path.trim()));
  const bootstrapFilesForInjectionStats = bootstrapRouting.includeBootstrapInSystemContext
    ? hookAdjustedBootstrapFiles
    : hookAdjustedBootstrapFiles.filter((file) => file.name !== DEFAULT_BOOTSTRAP_FILENAME);
  const bootstrapMaxChars = resolveBootstrapMaxChars(attempt.config, params.sessionAgentId);
  const bootstrapTotalMaxChars = resolveBootstrapTotalMaxChars(
    attempt.config,
    params.sessionAgentId,
  );
  const bootstrapAnalysis = analyzeBootstrapBudget({
    files: buildBootstrapInjectionStats({
      bootstrapFiles: bootstrapFilesForInjectionStats,
      injectedFiles: contextFiles,
    }),
    bootstrapMaxChars,
    bootstrapTotalMaxChars,
  });
  const bootstrapPromptWarningMode = resolveBootstrapPromptTruncationWarningMode(attempt.config);
  const bootstrapPromptWarning = buildBootstrapPromptWarning({
    analysis: bootstrapAnalysis,
    mode: bootstrapPromptWarningMode,
    seenSignatures: attempt.bootstrapPromptWarningSignaturesSeen,
    previousSignature: attempt.bootstrapPromptWarningSignature,
  });
  const workspaceNotes: string[] = [];
  if (
    hookAdjustedBootstrapFiles.some(
      (file) => file.name === DEFAULT_BOOTSTRAP_FILENAME && !file.missing,
    )
  ) {
    workspaceNotes.push("Reminder: commit your changes in this workspace after edits.");
  }
  if (isEmbeddedMode()) {
    workspaceNotes.push(
      "Running in local embedded mode (no gateway). Most tools work locally. Gateway-dependent tools (canvas, nodes, cron, message, sessions_send, sessions_spawn, gateway) are unavailable. Subagent kill/steer require a gateway. Do not attempt to read gateway-specific files such as sessions.json, gateway.log, or gateway.pid.",
    );
  }

  return {
    bootstrapAnalysis,
    bootstrapMaxChars,
    bootstrapMode,
    bootstrapPromptWarning,
    bootstrapPromptWarningMode,
    bootstrapTotalMaxChars,
    contextFiles,
    hookAdjustedBootstrapFiles,
    shouldRecordCompletedBootstrapTurn,
    workspaceNotes,
    stageB,
  };
}

/** Per-attempt final-context verification after the hook/adapter finalizes bootstrap files. */
export function resolveStageBForAttempt(params: {
  runLocalProjectionState: EmbeddedRunAttemptParams["runLocalProjectionState"];
  hookAdjustedBootstrapFiles: readonly WorkspaceBootstrapFile[];
}): StageBVerification {
  const runLocal = params.runLocalProjectionState;
  if (!runLocal) {
    return {
      ok: false,
      code: "PROJECTION_INJECTION_MISSING",
      entryCount: 0,
      entryDigest: null,
      expectedDigest: null,
    };
  }
  if (!runLocal.governance.governed) {
    return {
      ok: false,
      code: "PROJECTION_INJECTION_MISSING",
      entryCount: 0,
      entryDigest: null,
      expectedDigest: runLocal.preparation.expectedProjectionDigest,
    };
  }
  if (!runLocal.governance.state.mayExecute()) {
    return {
      ok: false,
      code: runLocal.governance.state.classification,
      entryCount: 0,
      entryDigest: null,
      expectedDigest: runLocal.preparation.expectedProjectionDigest,
    };
  }
  const injection = runLocal.injection;
  if (injection.ok) {
    return {
      ok: true,
      code: null,
      entryCount: injection.entryCount,
      entryDigest: injection.entryDigest,
      expectedDigest: runLocal.preparation.expectedProjectionDigest,
    };
  }
  const finalVerification = verifyFinalContextProjection(
    params.hookAdjustedBootstrapFiles,
    runLocal.preparation.expectedProjectionDigest,
  );
  runLocal.injection = finalVerification;
  return {
    ok: finalVerification.ok,
    code: finalVerification.code,
    entryCount: finalVerification.entryCount,
    entryDigest: finalVerification.entryDigest,
    expectedDigest: runLocal.preparation.expectedProjectionDigest,
  };
}
