/**
 * Execution backend resolution and governed backend policy evaluation.
 *
 * The effective execution backend is derived from the SAME runtime/config
 * resolution that selects `useCliExecution` for an agent run (session runtime
 * override + CLI runtime execution provider). The governed production route
 * requires OPENCLAW_EMBEDDED_PROVIDER_RUNTIME_ONLY; any effective CLI backend
 * is a pre-dispatch EXECUTION_BACKEND_POLICY_VIOLATION.
 */
import { parseModelCatalogRef } from "@openclaw/model-catalog-core/model-catalog-refs";
import { normalizeProviderId } from "@openclaw/model-catalog-core/provider-id";
import type { SessionEntry } from "../../config/sessions.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resolveCliRuntimeExecutionProvider } from "../model-runtime-aliases.js";
import { isCliProvider } from "../model-selection.js";
import { resolveSessionRuntimeOverrideForProvider } from "../session-runtime-compat.js";
import {
  ExecutionBackend,
  ExecutionBackendPolicy,
  EXECUTION_BACKEND_POLICY_VIOLATION_CLASSIFICATION,
  GOVERNED_EXECUTION_BACKEND_POLICY,
} from "./contracts-v2.js";

export type EffectiveExecutionBackendResolution = {
  effectiveBackend: ExecutionBackend;
  sessionRuntimeOverride: string | undefined;
  cliExecutionProvider: string | undefined;
};

/** Resolves the effective execution backend from the same truth as useCliExecution. */
export function resolveEffectiveExecutionBackend(params: {
  cfg?: OpenClawConfig;
  provider: string;
  modelId: string;
  agentId?: string;
  sessionEntry?: Pick<
    SessionEntry,
    "agentHarnessId" | "agentRuntimeOverride" | "modelSelectionLocked"
  >;
  authProfileId?: string;
}): EffectiveExecutionBackendResolution {
  const sessionRuntimeOverride = resolveSessionRuntimeOverrideForProvider({
    provider: params.provider,
    entry: params.sessionEntry,
    cfg: params.cfg,
  });
  if (sessionRuntimeOverride && isCliProvider(sessionRuntimeOverride, params.cfg)) {
    return {
      effectiveBackend: ExecutionBackend.CLI_PROVIDER_RUNTIME,
      sessionRuntimeOverride,
      cliExecutionProvider: sessionRuntimeOverride,
    };
  }
  const cliExecutionProvider = sessionRuntimeOverride
    ? undefined
    : resolveCliRuntimeExecutionProvider({
        provider: params.provider,
        cfg: params.cfg,
        agentId: params.agentId,
        modelId: params.modelId,
        authProfileId: params.authProfileId,
      });
  if (cliExecutionProvider && isCliProvider(cliExecutionProvider, params.cfg)) {
    return {
      effectiveBackend: ExecutionBackend.CLI_PROVIDER_RUNTIME,
      sessionRuntimeOverride,
      cliExecutionProvider,
    };
  }
  return {
    effectiveBackend: ExecutionBackend.OPENCLAW_EMBEDDED_PROVIDER_RUNTIME,
    sessionRuntimeOverride,
    cliExecutionProvider: undefined,
  };
}

/**
 * Resolves the governed route backend across the primary model and every
 * configured fallback candidate. A CLI backend on ANY candidate makes the
 * whole run ineligible: the fallback cycle could otherwise select the CLI
 * path after Gate 1 passed for the embedded primary.
 */
export function resolveGovernedExecutionBackendForRun(params: {
  cfg?: OpenClawConfig;
  provider: string;
  modelId: string;
  fallbackModelIds?: readonly string[];
  agentId?: string;
  sessionEntry?: Pick<
    SessionEntry,
    "agentHarnessId" | "agentRuntimeOverride" | "modelSelectionLocked"
  >;
  authProfileId?: string;
}): ExecutionBackend {
  const candidates = [params.modelId, ...(params.fallbackModelIds ?? [])];
  for (const modelId of candidates) {
    const resolution = resolveEffectiveExecutionBackend({
      cfg: params.cfg,
      provider: params.provider,
      modelId,
      agentId: params.agentId,
      sessionEntry: params.sessionEntry,
      authProfileId: params.authProfileId,
    });
    if (resolution.effectiveBackend === ExecutionBackend.CLI_PROVIDER_RUNTIME) {
      return ExecutionBackend.CLI_PROVIDER_RUNTIME;
    }
  }
  return ExecutionBackend.OPENCLAW_EMBEDDED_PROVIDER_RUNTIME;
}

/** True when a model ref resolves to a CLI runtime provider. */
export function isCliModelRef(value: string | undefined, cfg?: OpenClawConfig): boolean {
  const parsed = value?.trim() ? parseModelCatalogRef(value.trim()) : undefined;
  const provider = parsed?.provider ?? normalizeProviderId(value?.trim() ?? "");
  return Boolean(provider && isCliProvider(provider, cfg));
}

export type ExecutionBackendPolicyEvaluation =
  | { ok: true; effectiveBackend: ExecutionBackend }
  | {
      ok: false;
      effectiveBackend: ExecutionBackend;
      classification: string;
      diagnosticRef: string;
      sanitizedMessage: string;
    };

/** Evaluates the effective backend against the governed production policy. */
export function evaluateExecutionBackendPolicy(
  effectiveBackend: ExecutionBackend,
  policy: ExecutionBackendPolicy = GOVERNED_EXECUTION_BACKEND_POLICY,
): ExecutionBackendPolicyEvaluation {
  if (policy === ExecutionBackendPolicy.PROHIBITED) {
    return {
      ok: false,
      effectiveBackend,
      classification: EXECUTION_BACKEND_POLICY_VIOLATION_CLASSIFICATION,
      diagnosticRef: "execution-backend-policy-violation",
      sanitizedMessage:
        "This action cannot be completed because the execution backend policy prohibits the resolved backend.",
    };
  }
  if (effectiveBackend === ExecutionBackend.OPENCLAW_EMBEDDED_PROVIDER_RUNTIME) {
    return { ok: true, effectiveBackend };
  }
  if (effectiveBackend === ExecutionBackend.CLI_PROVIDER_RUNTIME) {
    return {
      ok: false,
      effectiveBackend,
      classification: EXECUTION_BACKEND_POLICY_VIOLATION_CLASSIFICATION,
      diagnosticRef: "execution-backend-policy-violation",
      sanitizedMessage:
        "This action cannot be completed because the execution backend policy prohibits a CLI runtime backend.",
    };
  }
  return {
    ok: false,
    effectiveBackend,
    classification: EXECUTION_BACKEND_POLICY_VIOLATION_CLASSIFICATION,
    diagnosticRef: "execution-backend-unresolved",
    sanitizedMessage:
      "This action cannot be completed because the effective execution backend could not be resolved.",
  };
}
