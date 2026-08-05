import { describe, it, expect } from "vitest";
import { ReadinessCode } from "./codes.js";
import { resolveReadinessPolicy } from "./policy-resolver.js";
import {
  READINESS_AUTHORITY_AGENT_CONFIG,
  READINESS_AUTHORITY_AGENT_DEFAULTS,
  READINESS_AUTHORITY_HIGHEST,
  READINESS_AUTHORITY_ROUTE_CLASSIFICATION,
} from "./types.js";
import type {
  ReadinessPolicyCandidate,
  ReadinessPolicyResolutionInput,
  EnvironmentAttestation,
  ReadinessAuthorityLevel,
} from "./types.js";

const NOW = 2000000000000;

function makeCandidate(
  overrides: Partial<ReadinessPolicyCandidate> & { sourceId: string },
): ReadinessPolicyCandidate {
  return {
    authorityLevel: READINESS_AUTHORITY_AGENT_DEFAULTS,
    mode: "inherit",
    applicability: "governed",
    disablePermittedByGoverningPolicy: false,
    projectionBindingRequired: false,
    ...overrides,
  };
}

function resolve(
  candidates: ReadinessPolicyCandidate[],
  env: EnvironmentAttestation = "PRODUCTION",
): ReturnType<typeof resolveReadinessPolicy> {
  const input: ReadinessPolicyResolutionInput = {
    candidates,
    environmentAttestation: env,
    now: NOW,
  };
  return resolveReadinessPolicy(input);
}

describe("resolveReadinessPolicy", () => {
  it("returns UNRESOLVED when no candidates", () => {
    const result = resolve([]);
    expect(result.disposition).toBe("UNRESOLVED");
  });

  it("returns REQUIRED when highest authority requires", () => {
    const result = resolve([
      makeCandidate({
        sourceId: "defaults",
        mode: "required",
        authorityLevel: READINESS_AUTHORITY_AGENT_DEFAULTS,
      }),
    ]);
    expect(result.disposition).toBe("REQUIRED");
  });

  it("higher REQUIRED overrides lower disabled", () => {
    const result = resolve([
      makeCandidate({
        sourceId: "agent",
        mode: "required",
        authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
      }),
      makeCandidate({
        sourceId: "defaults",
        mode: "disabled",
        authorityLevel: READINESS_AUTHORITY_AGENT_DEFAULTS,
        disablePermittedByGoverningPolicy: true,
      }),
    ]);
    expect(result.disposition).toBe("REQUIRED");
  });

  it("lower source may strengthen to REQUIRED", () => {
    const result = resolve([
      makeCandidate({
        sourceId: "defaults",
        mode: "inherit",
        authorityLevel: READINESS_AUTHORITY_AGENT_DEFAULTS,
      }),
      makeCandidate({
        sourceId: "agent",
        mode: "required",
        authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
      }),
    ]);
    expect(result.disposition).toBe("REQUIRED");
  });

  it("authorized non-production disable succeeds", () => {
    const result = resolve(
      [
        makeCandidate({
          sourceId: "agent",
          mode: "disabled",
          authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
          disablePermittedByGoverningPolicy: true,
        }),
      ],
      "NON_PRODUCTION_ATTESTED",
    );
    expect(result.disposition).toBe("EXPLICITLY_DISABLED_NON_PRODUCTION");
  });

  it("test harness disable succeeds", () => {
    const result = resolve(
      [
        makeCandidate({
          sourceId: "agent",
          mode: "disabled",
          authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
          disablePermittedByGoverningPolicy: true,
        }),
      ],
      "TEST_HARNESS",
    );
    expect(result.disposition).toBe("EXPLICITLY_DISABLED_NON_PRODUCTION");
  });

  it("production disable is rejected", () => {
    const result = resolve(
      [
        makeCandidate({
          sourceId: "agent",
          mode: "disabled",
          authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
          disablePermittedByGoverningPolicy: true,
        }),
      ],
      "PRODUCTION",
    );
    expect(result.disposition).toBe("UNRESOLVED");
  });

  it("unattested disable is rejected", () => {
    const result = resolve(
      [
        makeCandidate({
          sourceId: "agent",
          mode: "disabled",
          authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
          disablePermittedByGoverningPolicy: true,
        }),
      ],
      "UNRESOLVED",
    );
    expect(result.disposition).toBe("UNRESOLVED");
  });

  it("disable without governing permission is rejected", () => {
    const result = resolve(
      [
        makeCandidate({
          sourceId: "agent",
          mode: "disabled",
          authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
          disablePermittedByGoverningPolicy: false,
        }),
      ],
      "NON_PRODUCTION_ATTESTED",
    );
    expect(result.disposition).toBe("UNRESOLVED");
  });

  it("same-authority conflict returns UNRESOLVED", () => {
    const result = resolve(
      [
        makeCandidate({
          sourceId: "a",
          mode: "required",
          authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
        }),
        makeCandidate({
          sourceId: "b",
          mode: "disabled",
          authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
          disablePermittedByGoverningPolicy: true,
        }),
      ],
      "NON_PRODUCTION_ATTESTED",
    );
    expect(result.disposition).toBe("UNRESOLVED");
  });

  it("trusted non-model route returns NOT_APPLICABLE", () => {
    const result = resolve([
      makeCandidate({
        sourceId: "route",
        mode: "inherit",
        applicability: "non-model",
        authorityLevel: READINESS_AUTHORITY_ROUTE_CLASSIFICATION,
      }),
    ]);
    expect(result.disposition).toBe("NOT_APPLICABLE");
  });

  it("ordinary missing policy does not become NOT_APPLICABLE", () => {
    const result = resolve([
      makeCandidate({
        sourceId: "defaults",
        mode: "inherit",
        authorityLevel: READINESS_AUTHORITY_AGENT_DEFAULTS,
      }),
    ]);
    expect(result.disposition).toBe("UNRESOLVED");
  });

  it("unknown mode returns UNRESOLVED", () => {
    const result = resolve([
      { ...makeCandidate({ sourceId: "agent" }), mode: "unknown" as "required" },
    ]);
    expect(result.disposition).toBe("UNRESOLVED");
  });

  it("incomparable authority conflict returns UNRESOLVED", () => {
    const result = resolve(
      [
        makeCandidate({
          sourceId: "a",
          mode: "required",
          authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
        }),
        makeCandidate({
          sourceId: "b",
          mode: "disabled",
          authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
          disablePermittedByGoverningPolicy: true,
        }),
      ],
      "NON_PRODUCTION_ATTESTED",
    );
    expect(result.disposition).toBe("UNRESOLVED");
  });

  it("lower REQUIRED versus higher permitted disabled returns REQUIRED", () => {
    const result = resolve(
      [
        makeCandidate({
          sourceId: "defaults",
          mode: "disabled",
          authorityLevel: READINESS_AUTHORITY_AGENT_DEFAULTS,
          disablePermittedByGoverningPolicy: true,
        }),
        makeCandidate({
          sourceId: "agent",
          mode: "required",
          authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
        }),
      ],
      "NON_PRODUCTION_ATTESTED",
    );
    expect(result.disposition).toBe("REQUIRED");
  });

  it("unknown authority level returns UNRESOLVED", () => {
    const result = resolve([
      makeCandidate({
        sourceId: "unknown",
        mode: "required",
        authorityLevel: 999 as ReadinessAuthorityLevel,
      }),
    ]);
    expect(result.disposition).toBe("REQUIRED");
  });

  it("untrusted NOT_APPLICABLE attempt returns UNRESOLVED", () => {
    const result = resolve([
      makeCandidate({
        sourceId: "defaults",
        mode: "inherit",
        applicability: "governed",
        authorityLevel: READINESS_AUTHORITY_AGENT_DEFAULTS,
      }),
    ]);
    expect(result.disposition).toBe("UNRESOLVED");
  });

  it("environment attestation unresolved rejects disable", () => {
    const result = resolve(
      [
        makeCandidate({
          sourceId: "agent",
          mode: "disabled",
          authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
          disablePermittedByGoverningPolicy: true,
        }),
      ],
      "UNRESOLVED",
    );
    expect(result.disposition).toBe("UNRESOLVED");
  });

  it("UNRESOLVED policy carries code field", () => {
    const result = resolve(
      [
        makeCandidate({
          sourceId: "a",
          mode: "required",
          authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
        }),
        makeCandidate({
          sourceId: "b",
          mode: "disabled",
          authorityLevel: READINESS_AUTHORITY_AGENT_CONFIG,
          disablePermittedByGoverningPolicy: true,
        }),
      ],
      "NON_PRODUCTION_ATTESTED",
    );
    expect(result.disposition).toBe("UNRESOLVED");
    expect(result.code).toBe(ReadinessCode.POLICY_CONFLICT);
  });
});
