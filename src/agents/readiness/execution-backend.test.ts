import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliBackendConfig } from "../../plugins/cli-backend.types.js";
import {
  ExecutionBackend,
  ExecutionBackendPolicy,
  EXECUTION_BACKEND_POLICY_VIOLATION_CLASSIFICATION,
} from "./contracts-v2.js";
import {
  evaluateExecutionBackendPolicy,
  resolveEffectiveExecutionBackend,
  resolveGovernedExecutionBackendForRun,
} from "./execution-backend.js";

type CliBackendsTestApi = {
  resetDepsForTest(): void;
  setDepsForTest(deps: {
    resolveRuntimeCliBackends?: () => ReadonlyArray<{
      id: string;
      modelProvider?: string;
      config: CliBackendConfig;
    }>;
  }): void;
};

const cliBackendsTestApi = (globalThis as Record<PropertyKey, unknown>)[
  Symbol.for("openclaw.cliBackendsTestApi")
] as CliBackendsTestApi;

const CLI_BACKEND_ID = "claude-cli";

function installCliRuntimeBackend(overrides?: Partial<CliBackendConfig>): void {
  cliBackendsTestApi.setDepsForTest({
    resolveRuntimeCliBackends: () => [
      {
        id: CLI_BACKEND_ID,
        modelProvider: "anthropic",
        config: {
          command: "claude",
          ...(overrides ?? {}),
        },
      },
    ],
  });
}

beforeEach(() => {
  cliBackendsTestApi.resetDepsForTest();
});

afterEach(() => {
  cliBackendsTestApi.resetDepsForTest();
});

describe("execution-backend resolution", () => {
  it("standard governed OpenAI route resolves to OPENCLAW_EMBEDDED_PROVIDER_RUNTIME", () => {
    const resolution = resolveEffectiveExecutionBackend({
      provider: "openai",
      modelId: "openai/gpt-5.6-sol",
    });
    expect(resolution.effectiveBackend).toBe(ExecutionBackend.OPENCLAW_EMBEDDED_PROVIDER_RUNTIME);
    expect(resolution.cliExecutionProvider).toBeUndefined();
  });

  it("agentRuntime changed to CLI runtime changes the resolved backend", () => {
    installCliRuntimeBackend();
    const resolution = resolveEffectiveExecutionBackend({
      provider: "anthropic",
      modelId: "anthropic/claude-sonnet-4-6",
      sessionEntry: {
        agentHarnessId: CLI_BACKEND_ID,
        modelSelectionLocked: true,
      },
    });
    expect(resolution.effectiveBackend).toBe(ExecutionBackend.CLI_PROVIDER_RUNTIME);
    expect(resolution.cliExecutionProvider).toBe(CLI_BACKEND_ID);
  });

  it("CLI runtime on a fallback candidate blocks the whole run", () => {
    installCliRuntimeBackend();
    const backend = resolveGovernedExecutionBackendForRun({
      provider: "openai",
      modelId: "openai/gpt-5.6-sol",
      fallbackModelIds: ["openai/gpt-5.6-luna"],
      sessionEntry: {
        agentHarnessId: CLI_BACKEND_ID,
        modelSelectionLocked: true,
      },
    });
    expect(backend).toBe(ExecutionBackend.CLI_PROVIDER_RUNTIME);
  });

  it("unrecognized provider with no CLI binding stays embedded", () => {
    const backend = resolveGovernedExecutionBackendForRun({
      provider: "unknown-provider",
      modelId: "unknown-provider/model",
    });
    expect(backend).toBe(ExecutionBackend.OPENCLAW_EMBEDDED_PROVIDER_RUNTIME);
  });
});

describe("execution-backend policy evaluation", () => {
  it("embedded backend passes the governed production policy", () => {
    const evaluation = evaluateExecutionBackendPolicy(
      ExecutionBackend.OPENCLAW_EMBEDDED_PROVIDER_RUNTIME,
    );
    expect(evaluation.ok).toBe(true);
  });

  it("CLI runtime under production policy is BLOCKED pre-dispatch", () => {
    const evaluation = evaluateExecutionBackendPolicy(ExecutionBackend.CLI_PROVIDER_RUNTIME);
    expect(evaluation.ok).toBe(false);
    if (!evaluation.ok) {
      expect(evaluation.classification).toBe(EXECUTION_BACKEND_POLICY_VIOLATION_CLASSIFICATION);
      expect(evaluation.diagnosticRef).toBe("execution-backend-policy-violation");
    }
  });

  it("same provider/model with different execution backend is detected and BLOCKED", () => {
    const embedded = evaluateExecutionBackendPolicy(
      ExecutionBackend.OPENCLAW_EMBEDDED_PROVIDER_RUNTIME,
    );
    const cli = evaluateExecutionBackendPolicy(ExecutionBackend.CLI_PROVIDER_RUNTIME);
    expect(embedded.ok).toBe(true);
    expect(cli.ok).toBe(false);
    expect(ExecutionBackendPolicy.OPENCLAW_EMBEDDED_PROVIDER_RUNTIME_ONLY).toBe(
      ExecutionBackendPolicy.OPENCLAW_EMBEDDED_PROVIDER_RUNTIME_ONLY,
    );
  });

  it("unrecognized backend is BLOCKED", () => {
    const evaluation = evaluateExecutionBackendPolicy("UNKNOWN_BACKEND" as ExecutionBackend);
    expect(evaluation.ok).toBe(false);
    if (!evaluation.ok) {
      expect(evaluation.diagnosticRef).toBe("execution-backend-unresolved");
    }
  });

  it("missing backend truth is BLOCKED", () => {
    const evaluation = evaluateExecutionBackendPolicy(ExecutionBackend.UNRESOLVED);
    expect(evaluation.ok).toBe(false);
    if (!evaluation.ok) {
      expect(evaluation.classification).toBe(EXECUTION_BACKEND_POLICY_VIOLATION_CLASSIFICATION);
      expect(evaluation.diagnosticRef).toBe("execution-backend-unresolved");
    }
  });

  it("PROHIBITED policy blocks even an embedded backend", () => {
    const evaluation = evaluateExecutionBackendPolicy(
      ExecutionBackend.OPENCLAW_EMBEDDED_PROVIDER_RUNTIME,
      ExecutionBackendPolicy.PROHIBITED,
    );
    expect(evaluation.ok).toBe(false);
  });
});
