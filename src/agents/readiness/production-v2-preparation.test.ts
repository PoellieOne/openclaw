import { describe, it, expect } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  buildGovernedReadinessConfigSource,
  canonicalizeReadinessModelRef,
  computeGovernedExpectedConfigDigest,
} from "./production-v2-preparation.js";

const GOVERNING_DIGEST = "b04e02acf658776e688c9bf3ee4cf099497dfe4f6afc077ae7c7b916860c193c";

const cfg: OpenClawConfig = {
  agents: {
    defaults: {
      contextInjection: "always",
      model: { primary: "openai/gpt-5.6-sol" },
      models: { "openai/gpt-5.6-sol": {} },
    },
    entries: {
      sophia: {
        default: true,
        workspace: "/state/workspace",
        agentDir: "/state/agents/sophia/agent",
        contextInjection: "always",
      },
    },
  },
};

function makeSource(provider: string, model: string) {
  return buildGovernedReadinessConfigSource({
    cfg,
    agentId: "sophia",
    provider,
    model,
    workspaceDir: "/state/workspace",
    agentDir: "/state/agents/sophia/agent",
  });
}

describe("canonicalizeReadinessModelRef", () => {
  it("qualifies a bare runtime model id with the provider", () => {
    expect(canonicalizeReadinessModelRef("openai", "gpt-5.6-sol")).toBe("openai/gpt-5.6-sol");
  });

  it("keeps an already fully-qualified model id stable without double-prefix", () => {
    expect(canonicalizeReadinessModelRef("openai", "openai/gpt-5.6-sol")).toBe(
      "openai/gpt-5.6-sol",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(canonicalizeReadinessModelRef("openai", "  gpt-5.6-sol  ")).toBe("openai/gpt-5.6-sol");
  });

  it("leaves a foreign-provider model id untouched (no silent rebinding)", () => {
    expect(canonicalizeReadinessModelRef("openai", "anthropic/claude-x")).toBe(
      "anthropic/claude-x",
    );
  });

  it("returns an empty model id unchanged", () => {
    expect(canonicalizeReadinessModelRef("openai", "")).toBe("");
  });
});

describe("buildGovernedReadinessConfigSource canonical model binding", () => {
  it("short-form runtime model produces the governing config digest", () => {
    const source = makeSource("openai", "gpt-5.6-sol");
    expect(source.effectivePrimaryModel).toBe("openai/gpt-5.6-sol");
    expect(computeGovernedExpectedConfigDigest(source)).toBe(GOVERNING_DIGEST);
  });

  it("already-qualified model produces the identical governing digest", () => {
    const source = makeSource("openai", "openai/gpt-5.6-sol");
    expect(source.effectivePrimaryModel).toBe("openai/gpt-5.6-sol");
    expect(computeGovernedExpectedConfigDigest(source)).toBe(GOVERNING_DIGEST);
  });

  it("short-form and qualified forms are digest-equivalent", () => {
    const short = computeGovernedExpectedConfigDigest(makeSource("openai", "gpt-5.6-sol"));
    const qualified = computeGovernedExpectedConfigDigest(
      makeSource("openai", "openai/gpt-5.6-sol"),
    );
    expect(short).toBe(qualified);
  });

  it("foreign-provider model id does not produce a false governing binding", () => {
    const source = makeSource("openai", "anthropic/claude-x");
    expect(source.effectivePrimaryModel).toBe("anthropic/claude-x");
    expect(computeGovernedExpectedConfigDigest(source)).not.toBe(GOVERNING_DIGEST);
  });

  it("empty model id does not produce a false governing binding", () => {
    const source = makeSource("openai", "");
    expect(source.effectivePrimaryModel).toBe("");
    expect(computeGovernedExpectedConfigDigest(source)).not.toBe(GOVERNING_DIGEST);
  });

  it("does not change channel semantics (channel stays empty when not supplied)", () => {
    const source = makeSource("openai", "gpt-5.6-sol");
    expect(source.routingBindings[0]?.match.channel).toBe("");
  });

  it("does not change the other digest-bearing fields", () => {
    const short = makeSource("openai", "gpt-5.6-sol");
    const qualified = makeSource("openai", "openai/gpt-5.6-sol");
    expect(short.targetAgentId).toBe(qualified.targetAgentId);
    expect(short.defaultAgentId).toBe(qualified.defaultAgentId);
    expect(short.effectiveModelFallbacks).toEqual(qualified.effectiveModelFallbacks);
    expect(short.contextInjection).toBe(qualified.contextInjection);
    expect(short.skipBootstrap).toBe(qualified.skipBootstrap);
    expect(short.workspace).toBe(qualified.workspace);
    expect(short.agentDir).toBe(qualified.agentDir);
    expect(short.readinessPolicyMode).toBe(qualified.readinessPolicyMode);
    expect(short.requiredReadinessContractVersion).toBe(qualified.requiredReadinessContractVersion);
    expect(short.providerPolicy).toBe(qualified.providerPolicy);
    expect(short.modelPolicy).toBe(qualified.modelPolicy);
    expect(short.preferredAuthMethodPolicy).toBe(qualified.preferredAuthMethodPolicy);
    expect(short.fallbackPolicy).toBe(qualified.fallbackPolicy);
    expect(short.effectiveExecutionBackend).toBe(qualified.effectiveExecutionBackend);
    expect(short.executionBackendPolicy).toBe(qualified.executionBackendPolicy);
  });
});
