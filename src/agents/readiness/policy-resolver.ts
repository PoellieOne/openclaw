import { ReadinessCode } from "./codes.js";
import type {
  ReadinessAuthorityLevel,
  ReadinessPolicyResolutionInput,
  ResolvedReadinessPolicy,
} from "./types.js";

export function resolveReadinessPolicy(
  input: ReadinessPolicyResolutionInput,
): ResolvedReadinessPolicy {
  const { candidates, environmentAttestation, now } = input;

  if (candidates.length === 0) {
    return {
      disposition: "UNRESOLVED",
      source: { sourceId: "none", authorityLevel: 100 as ReadinessAuthorityLevel },
      environmentAttestation,
      projectionBindingRequired: false,
      resolvedAt: now,
    };
  }

  const governed = candidates.filter((c) => c.applicability === "governed");
  if (governed.length === 0) {
    const nonModel = candidates.find((c) => c.applicability === "non-model");
    if (nonModel) {
      return {
        disposition: "NOT_APPLICABLE",
        source: { sourceId: nonModel.sourceId, authorityLevel: nonModel.authorityLevel },
        environmentAttestation,
        projectionBindingRequired: false,
        resolvedAt: now,
      };
    }
    return {
      disposition: "UNRESOLVED",
      source: { sourceId: "none", authorityLevel: 100 as ReadinessAuthorityLevel },
      environmentAttestation,
      projectionBindingRequired: false,
      resolvedAt: now,
    };
  }

  const sorted = [...governed].sort((a, b) => {
    if (a.authorityLevel !== b.authorityLevel) return a.authorityLevel - b.authorityLevel;
    return 0;
  });

  const highest = sorted[0]!;
  const sameLevel = sorted.filter(
    (c) => c.authorityLevel === highest.authorityLevel && c.sourceId !== highest.sourceId,
  );

  if (sameLevel.length > 0) {
    const allRequired = [highest, ...sameLevel].every((c) => c.mode === "required");
    const allDisabled = [highest, ...sameLevel].every((c) => c.mode === "disabled");
    if (!allRequired && !allDisabled) {
      return {
        disposition: "UNRESOLVED",
        code: ReadinessCode.POLICY_CONFLICT,
        source: { sourceId: "conflict", authorityLevel: highest.authorityLevel },
        environmentAttestation,
        projectionBindingRequired: false,
        resolvedAt: now,
      };
    }
  }

  if (highest.mode === "required") {
    return {
      disposition: "REQUIRED",
      source: { sourceId: highest.sourceId, authorityLevel: highest.authorityLevel },
      environmentAttestation,
      policyId: highest.policyId,
      contractVersion: highest.contractVersion,
      maximumAgeMs: highest.maximumAgeMs,
      projectionBindingRequired: highest.projectionBindingRequired,
      resolvedAt: now,
    };
  }

  if (highest.mode === "disabled") {
    if (!highest.disablePermittedByGoverningPolicy) {
      return {
        disposition: "UNRESOLVED",
        code: ReadinessCode.POLICY_DISABLE_NOT_AUTHORIZED,
        source: { sourceId: highest.sourceId, authorityLevel: highest.authorityLevel },
        environmentAttestation,
        projectionBindingRequired: false,
        resolvedAt: now,
      };
    }

    if (environmentAttestation === "PRODUCTION" || environmentAttestation === "UNRESOLVED") {
      return {
        disposition: "UNRESOLVED",
        code: ReadinessCode.POLICY_DISABLE_ON_PRODUCTION,
        source: { sourceId: highest.sourceId, authorityLevel: highest.authorityLevel },
        environmentAttestation,
        projectionBindingRequired: false,
        resolvedAt: now,
      };
    }

    return {
      disposition: "EXPLICITLY_DISABLED_NON_PRODUCTION",
      source: { sourceId: highest.sourceId, authorityLevel: highest.authorityLevel },
      environmentAttestation,
      projectionBindingRequired: false,
      resolvedAt: now,
    };
  }

  if (highest.mode === "inherit") {
    const inherited = governed.find((c) => c.sourceId !== highest.sourceId && c.mode !== "inherit");
    if (inherited) {
      if (inherited.mode === "required") {
        return {
          disposition: "REQUIRED",
          source: { sourceId: inherited.sourceId, authorityLevel: inherited.authorityLevel },
          environmentAttestation,
          policyId: inherited.policyId,
          contractVersion: inherited.contractVersion,
          maximumAgeMs: inherited.maximumAgeMs,
          projectionBindingRequired: inherited.projectionBindingRequired,
          resolvedAt: now,
        };
      }
      if (inherited.mode === "disabled") {
        if (!inherited.disablePermittedByGoverningPolicy) {
          return {
            disposition: "UNRESOLVED",
            code: ReadinessCode.POLICY_DISABLE_NOT_AUTHORIZED,
            source: { sourceId: inherited.sourceId, authorityLevel: inherited.authorityLevel },
            environmentAttestation,
            projectionBindingRequired: false,
            resolvedAt: now,
          };
        }
        if (environmentAttestation === "PRODUCTION" || environmentAttestation === "UNRESOLVED") {
          return {
            disposition: "UNRESOLVED",
            code: ReadinessCode.POLICY_DISABLE_ON_PRODUCTION,
            source: { sourceId: inherited.sourceId, authorityLevel: inherited.authorityLevel },
            environmentAttestation,
            projectionBindingRequired: false,
            resolvedAt: now,
          };
        }
        return {
          disposition: "EXPLICITLY_DISABLED_NON_PRODUCTION",
          source: { sourceId: inherited.sourceId, authorityLevel: inherited.authorityLevel },
          environmentAttestation,
          projectionBindingRequired: false,
          resolvedAt: now,
        };
      }
    }
    return {
      disposition: "UNRESOLVED",
      source: { sourceId: highest.sourceId, authorityLevel: highest.authorityLevel },
      environmentAttestation,
      projectionBindingRequired: false,
      resolvedAt: now,
    };
  }

  return {
    disposition: "UNRESOLVED",
    source: { sourceId: highest.sourceId, authorityLevel: highest.authorityLevel },
    environmentAttestation,
    projectionBindingRequired: false,
    resolvedAt: now,
  };
}
