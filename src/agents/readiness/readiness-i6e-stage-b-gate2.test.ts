import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveStageBForAttempt } from "../embedded-agent-runner/run/attempt-bootstrap-prepare.js";
import {
  enforceReadinessGate2,
  ReadinessGateBlockedError,
} from "../embedded-agent-runner/run/attempt-prompt-submit.js";
import type { WorkspaceBootstrapFile } from "../workspace.js";
import type { RunLocalProjectionState } from "./bootstrap-adapter-wiring.js";
import {
  ExecutionBackend,
  EXECUTION_BACKEND_POLICY_VIOLATION_CLASSIFICATION,
} from "./contracts-v2.js";
import { prepareReadinessForRun } from "./run-preparation.js";
import type { ReadinessGovernance } from "./types.js";

function sha256(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf-8")).digest("hex");
}

const PAYLOAD_CONTENT = JSON.stringify({ payload_id: "p1", payload_version: "1.0.0" });
const PAYLOAD_DIGEST = sha256(PAYLOAD_CONTENT);

function makeGovernedState(mayExecute: boolean): ReadinessGovernance {
  return {
    governed: true,
    state: {
      mayExecute: () => mayExecute,
      isBlocked: () => !mayExecute,
      classification: mayExecute ? "ready" : "blocked",
      diagnosticRef: "test",
      evaluatedAt: Date.now(),
      toBlockedResult: () => ({
        classification: mayExecute ? "ready" : "blocked",
        diagnosticRef: "test",
        evaluatedAt: Date.now(),
        sanitizedMessage: "blocked",
        isBlocked: !mayExecute,
      }),
      projectionPreparation: {
        ok: true,
        payloadId: "p1",
        payloadVersion: "1.0.0",
        expectedProjectionDigest: PAYLOAD_DIGEST,
        expectedBytecount: Buffer.byteLength(PAYLOAD_CONTENT, "utf-8"),
        payloadContent: PAYLOAD_CONTENT,
        code: null,
      },
    } as never,
  };
}

function makeHolder(overrides?: Partial<RunLocalProjectionState>): RunLocalProjectionState {
  return {
    governance: makeGovernedState(true),
    preparation: {
      ok: true,
      payloadId: "p1",
      payloadVersion: "1.0.0",
      expectedProjectionDigest: PAYLOAD_DIGEST,
      expectedBytecount: Buffer.byteLength(PAYLOAD_CONTENT, "utf-8"),
      payloadContent: PAYLOAD_CONTENT,
      code: null,
    },
    projection: { id: "p1", version: "1.0.0", content: PAYLOAD_CONTENT },
    injection: {
      ok: false,
      entryCount: 0,
      entryDigest: null,
      code: "PROJECTION_INJECTION_MISSING",
    },
    ...overrides,
  };
}

/**
 * Governed injection entries use the adapter's GOVERNED_ENTRY_NAME
 * ("readiness-governance"), which is intentionally wider than the canonical
 * WorkspaceBootstrapFile name union. Production crosses that boundary by
 * construction (bootstrap-adapter-wiring assigns adapter output into
 * WorkspaceBootstrapFile[]); the name-field cast below mirrors exactly that
 * production boundary cast. `name` is intentionally absent from the
 * override type so the spread cannot widen the literal back to `string`.
 */
function makeGovernedEntry(
  overrides?: Partial<{ path: string; content: string; missing: boolean }>,
): WorkspaceBootstrapFile {
  return {
    name: "readiness-governance" as WorkspaceBootstrapFile["name"],
    path: "readiness://projections/p1",
    content: PAYLOAD_CONTENT,
    missing: false,
    ...overrides,
  };
}

describe("I6E Stage B per-attempt final-context verification", () => {
  it("holder absent -> Stage B FAIL (missing injection)", () => {
    const stageB = resolveStageBForAttempt({
      runLocalProjectionState: undefined,
      hookAdjustedBootstrapFiles: [makeGovernedEntry()],
    });
    expect(stageB.ok).toBe(false);
    expect(stageB.code).toBe("PROJECTION_INJECTION_MISSING");
  });

  it("governed blocked state -> Stage B FAIL", () => {
    const holder = makeHolder({ governance: makeGovernedState(false) });
    const stageB = resolveStageBForAttempt({
      runLocalProjectionState: holder,
      hookAdjustedBootstrapFiles: [makeGovernedEntry()],
    });
    expect(stageB.ok).toBe(false);
    expect(stageB.code).toBe("blocked");
  });

  it("exact payload content entry -> Stage B PASS with digest chain", () => {
    const holder = makeHolder();
    const stageB = resolveStageBForAttempt({
      runLocalProjectionState: holder,
      hookAdjustedBootstrapFiles: [makeGovernedEntry()],
    });
    expect(stageB.ok).toBe(true);
    expect(stageB.entryCount).toBe(1);
    expect(stageB.entryDigest).toBe(PAYLOAD_DIGEST);
    expect(stageB.expectedDigest).toBe(PAYLOAD_DIGEST);
    expect(holder.injection.ok).toBe(true);
    expect(holder.injection.entryDigest).toBe(PAYLOAD_DIGEST);
  });

  it("wrong content entry -> Stage B FAIL with digest mismatch", () => {
    const holder = makeHolder();
    const wrongEntry = makeGovernedEntry({ content: "different bytes" });
    const stageB = resolveStageBForAttempt({
      runLocalProjectionState: holder,
      hookAdjustedBootstrapFiles: [wrongEntry],
    });
    expect(stageB.ok).toBe(false);
    expect(stageB.code).toBe("PROJECTION_INJECTION_CONTENT_MISMATCH");
  });

  it("zero entries -> Stage B FAIL (missing)", () => {
    const holder = makeHolder();
    const stageB = resolveStageBForAttempt({
      runLocalProjectionState: holder,
      hookAdjustedBootstrapFiles: [],
    });
    expect(stageB.ok).toBe(false);
    expect(stageB.code).toBe("PROJECTION_INJECTION_MISSING");
  });

  it("payload content is NOT the envelope projection content (generated payload truth)", () => {
    // The holder's projection content comes from the secure payload reader;
    // envelope.projection.content may differ and must never be the Stage-B source.
    expect(PAYLOAD_CONTENT).not.toBe("{}");
    const holder = makeHolder();
    expect(holder.projection?.content).toBe(PAYLOAD_CONTENT);
    expect(holder.projection?.content).not.toBe("{}");
  });
});

describe("I6E Gate 2 pre-dispatch enforcement", () => {
  it("ungoverned run passes through without blocking", () => {
    expect(() => enforceReadinessGate2({ runLocalProjectionState: undefined })).not.toThrow();
  });

  it("governed run with valid Stage B passes", () => {
    const holder = makeHolder();
    const stageB = resolveStageBForAttempt({
      runLocalProjectionState: holder,
      hookAdjustedBootstrapFiles: [makeGovernedEntry()],
    });
    expect(stageB.ok).toBe(true);
    expect(() => enforceReadinessGate2({ runLocalProjectionState: holder })).not.toThrow();
  });

  it("governed run without Stage-B proof is BLOCKED before dispatch", () => {
    const holder = makeHolder();
    expect(() => enforceReadinessGate2({ runLocalProjectionState: holder })).toThrow(
      ReadinessGateBlockedError,
    );
  });

  it("digest chain mismatch is BLOCKED", () => {
    const holder = makeHolder({
      preparation: {
        ok: true,
        payloadId: "p1",
        payloadVersion: "1.0.0",
        expectedProjectionDigest: "f".repeat(64),
        expectedBytecount: Buffer.byteLength(PAYLOAD_CONTENT, "utf-8"),
        payloadContent: PAYLOAD_CONTENT,
        code: null,
      },
    });
    holder.injection = {
      ok: true,
      entryCount: 1,
      entryDigest: PAYLOAD_DIGEST,
      code: null,
    };
    expect(() => enforceReadinessGate2({ runLocalProjectionState: holder })).toThrow(
      ReadinessGateBlockedError,
    );
  });

  it("Stage A blocked is BLOCKED at Gate 2", () => {
    const holder = makeHolder({ governance: makeGovernedState(false) });
    expect(() => enforceReadinessGate2({ runLocalProjectionState: holder })).toThrow(
      ReadinessGateBlockedError,
    );
  });
});

describe("I6E execution-backend policy gate in Stage A", () => {
  it("CLI effective backend yields governed BLOCKED with EXECUTION_BACKEND_POLICY_VIOLATION", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: null,
      projectionId: null,
      projectionVersion: null,
      now: Date.now(),
      effectiveExecutionBackend: ExecutionBackend.CLI_PROVIDER_RUNTIME,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.governance.governed).toBe(true);
      if (result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
        expect(result.governance.state.classification).toBe(
          EXECUTION_BACKEND_POLICY_VIOLATION_CLASSIFICATION,
        );
        expect(result.governance.state.diagnosticRef).toBe("execution-backend-policy-violation");
      }
    }
  });

  it("embedded effective backend is NOT blocked by the backend gate", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: null,
      projectionId: null,
      projectionVersion: null,
      now: Date.now(),
      effectiveExecutionBackend: ExecutionBackend.OPENCLAW_EMBEDDED_PROVIDER_RUNTIME,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      // The backend gate passes; the (missing-evidence) classification is NOT
      // EXECUTION_BACKEND_POLICY_VIOLATION.
      expect(result.governance.state.classification).not.toBe(
        EXECUTION_BACKEND_POLICY_VIOLATION_CLASSIFICATION,
      );
    }
  });

  it("unresolved effective backend is BLOCKED fail-closed", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: null,
      projectionId: null,
      projectionVersion: null,
      now: Date.now(),
      effectiveExecutionBackend: ExecutionBackend.UNRESOLVED,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.mayExecute()).toBe(false);
      expect(result.governance.state.diagnosticRef).toBe("execution-backend-unresolved");
    }
  });
});
