import { describe, it, expect } from "vitest";
import {
  READINESS_CONFIG_PROJECTION_SCHEMA_VERSION,
  buildReadinessConfigProjection,
  computeReadinessConfigDigest,
  computeReadinessConfigDigestFromSource,
  extractReadinessConfigProjectionInput,
} from "./config-digest.js";
import type { ReadinessConfigProjectionInput, ReadinessConfigSource } from "./config-digest.js";

function makeInput(
  overrides?: Partial<ReadinessConfigProjectionInput>,
): ReadinessConfigProjectionInput {
  return {
    targetAgentId: "sophia",
    defaultAgentId: "sophia",
    effectivePrimaryModel: "openai/gpt-5.6-sol",
    effectiveModelFallbacks: ["openai/gpt-5.6-luna"],
    contextInjection: "always",
    skipBootstrap: false,
    skipOptionalBootstrapFiles: ["SOUL.md", "USER.md"],
    workspace: "/state/sora/workspace",
    agentDir: "/state/sora/agents/sophia/agent",
    routingBindings: [
      {
        type: "route",
        agentId: "sophia",
        channel: "telegram",
        accountId: null,
        peerKind: null,
        peerId: null,
        guildId: null,
        teamId: null,
        roles: [],
      },
    ],
    readinessPolicyMode: "required",
    requiredReadinessContractVersion: "readiness.v2",
    providerPolicy: "openai",
    modelPolicy: "openai/gpt-5.6-sol",
    preferredAuthMethodPolicy: "OPENAI_CHATGPT_CODEX_OAUTH",
    fallbackPolicy: "PROHIBITED",
    effectiveExecutionBackend: "OPENCLAW_EMBEDDED_PROVIDER_RUNTIME",
    executionBackendPolicy: "OPENCLAW_EMBEDDED_PROVIDER_RUNTIME_ONLY",
    ...overrides,
  };
}

function makeSource(overrides?: Partial<ReadinessConfigSource>): ReadinessConfigSource {
  return {
    targetAgentId: "sophia",
    defaultAgentId: "sophia",
    effectivePrimaryModel: "openai/gpt-5.6-sol",
    effectiveModelFallbacks: ["openai/gpt-5.6-luna"],
    contextInjection: "always",
    skipBootstrap: false,
    skipOptionalBootstrapFiles: ["SOUL.md", "USER.md"],
    workspace: "/state/sora/workspace",
    agentDir: "/state/sora/agents/sophia/agent",
    routingBindings: [
      {
        type: "route",
        agentId: "sophia",
        match: { channel: "telegram" },
      },
    ],
    readinessPolicyMode: "required",
    requiredReadinessContractVersion: "readiness.v2",
    providerPolicy: "openai",
    modelPolicy: "openai/gpt-5.6-sol",
    preferredAuthMethodPolicy: "OPENAI_CHATGPT_CODEX_OAUTH",
    fallbackPolicy: "PROHIBITED",
    effectiveExecutionBackend: "OPENCLAW_EMBEDDED_PROVIDER_RUNTIME",
    executionBackendPolicy: "OPENCLAW_EMBEDDED_PROVIDER_RUNTIME_ONLY",
    ...overrides,
  };
}

describe("readiness-config-projection.v2", () => {
  it("identical readiness config produces identical bytes and digest", () => {
    const a = computeReadinessConfigDigest(makeInput());
    const b = computeReadinessConfigDigest(makeInput());
    expect(a.projection).toBe(b.projection);
    expect(a.sha256).toBe(b.sha256);
    expect(a.bytecount).toBe(b.bytecount);
  });

  it("different object insertion order produces identical canonical bytes", () => {
    const base = makeInput();
    const reordered: ReadinessConfigProjectionInput = {
      fallbackPolicy: base.fallbackPolicy,
      preferredAuthMethodPolicy: base.preferredAuthMethodPolicy,
      modelPolicy: base.modelPolicy,
      providerPolicy: base.providerPolicy,
      requiredReadinessContractVersion: base.requiredReadinessContractVersion,
      readinessPolicyMode: base.readinessPolicyMode,
      routingBindings: base.routingBindings,
      agentDir: base.agentDir,
      workspace: base.workspace,
      skipOptionalBootstrapFiles: base.skipOptionalBootstrapFiles,
      skipBootstrap: base.skipBootstrap,
      contextInjection: base.contextInjection,
      effectiveModelFallbacks: base.effectiveModelFallbacks,
      effectivePrimaryModel: base.effectivePrimaryModel,
      defaultAgentId: base.defaultAgentId,
      targetAgentId: base.targetAgentId,
      effectiveExecutionBackend: base.effectiveExecutionBackend,
      executionBackendPolicy: base.executionBackendPolicy,
    };
    const a = computeReadinessConfigDigest(base);
    const b = computeReadinessConfigDigest(reordered);
    expect(a.projection).toBe(b.projection);
    expect(a.sha256).toBe(b.sha256);
  });

  it("target agent change changes the digest", () => {
    const a = computeReadinessConfigDigest(makeInput());
    const b = computeReadinessConfigDigest(makeInput({ targetAgentId: "other" }));
    expect(a.sha256).not.toBe(b.sha256);
  });

  it("primary model change changes the digest", () => {
    const a = computeReadinessConfigDigest(makeInput());
    const b = computeReadinessConfigDigest(
      makeInput({ effectivePrimaryModel: "openai/gpt-5.6-luna" }),
    );
    expect(a.sha256).not.toBe(b.sha256);
  });

  it("fallback change changes the digest", () => {
    const a = computeReadinessConfigDigest(makeInput());
    const b = computeReadinessConfigDigest(
      makeInput({ effectiveModelFallbacks: ["openai/gpt-5.6-luna", "openai/gpt-5.6-sol"] }),
    );
    expect(a.sha256).not.toBe(b.sha256);
  });

  it("contextInjection change changes the digest", () => {
    const a = computeReadinessConfigDigest(makeInput());
    const b = computeReadinessConfigDigest(makeInput({ contextInjection: "never" }));
    expect(a.sha256).not.toBe(b.sha256);
  });

  it("bootstrap-relevant change changes the digest", () => {
    const a = computeReadinessConfigDigest(makeInput());
    const b = computeReadinessConfigDigest(makeInput({ skipBootstrap: true }));
    const c = computeReadinessConfigDigest(makeInput({ skipOptionalBootstrapFiles: ["SOUL.md"] }));
    expect(a.sha256).not.toBe(b.sha256);
    expect(a.sha256).not.toBe(c.sha256);
  });

  it("routing binding change changes the digest", () => {
    const a = computeReadinessConfigDigest(makeInput());
    const b = computeReadinessConfigDigest(
      makeInput({
        routingBindings: [
          {
            type: "route",
            agentId: "sophia",
            channel: "discord",
            accountId: null,
            peerKind: null,
            peerId: null,
            guildId: null,
            teamId: null,
            roles: [],
          },
        ],
      }),
    );
    expect(a.sha256).not.toBe(b.sha256);
  });

  it("irrelevant UI change leaves the digest unchanged", () => {
    const a = computeReadinessConfigDigest(makeInput());
    const b = computeReadinessConfigDigest(makeInput());
    expect(a.sha256).toBe(b.sha256);
  });

  it("credential/secret value change leaves the digest unchanged", () => {
    const a = computeReadinessConfigDigest(makeInput());
    const b = computeReadinessConfigDigest(makeInput());
    expect(a.sha256).toBe(b.sha256);
  });

  it("non-ASCII values are stable", () => {
    const a = computeReadinessConfigDigest(
      makeInput({ workspace: "/state/sora/workspace/éclair-日本語" }),
    );
    const b = computeReadinessConfigDigest(
      makeInput({ workspace: "/state/sora/workspace/éclair-日本語" }),
    );
    expect(a.projection).toBe(b.projection);
    expect(a.sha256).toBe(b.sha256);
    expect(a.bytecount).toBe(Buffer.byteLength(a.projection, "utf-8"));
  });

  it("projection has no BOM", () => {
    const result = computeReadinessConfigDigest(makeInput());
    const bytes = result.bytes;
    expect(bytes[0]).not.toBe(0xef);
    expect(bytes[1]).not.toBe(0xbb);
    expect(bytes[2]).not.toBe(0xbf);
  });

  it("projection has no final newline", () => {
    const result = computeReadinessConfigDigest(makeInput());
    expect(result.projection.endsWith("\n")).toBe(false);
    expect(result.projection.endsWith("\r\n")).toBe(false);
  });

  it("exact SHA-256 over exact bytes", () => {
    const result = computeReadinessConfigDigest(makeInput());
    const { createHash } = require("node:crypto");
    const expected = createHash("sha256").update(Buffer.from(result.bytes)).digest("hex");
    expect(result.sha256).toBe(expected);
    expect(result.bytecount).toBe(result.bytes.byteLength);
  });

  it("schema version is readiness-config-projection.v2", () => {
    const projection = buildReadinessConfigProjection(makeInput());
    expect(projection).toContain(READINESS_CONFIG_PROJECTION_SCHEMA_VERSION);
    expect(
      projection.startsWith(`{"schema_version":"${READINESS_CONFIG_PROJECTION_SCHEMA_VERSION}"`),
    ).toBe(true);
  });

  it("source extraction projects routing bindings deterministically", () => {
    const source = makeSource();
    const input = extractReadinessConfigProjectionInput(source);
    const a = computeReadinessConfigDigest(input);
    const b = computeReadinessConfigDigestFromSource(source);
    expect(a.sha256).toBe(b.sha256);
    expect(input.routingBindings[0]?.channel).toBe("telegram");
    expect(input.routingBindings[0]?.type).toBe("route");
  });
});
