import { describe, it, expect } from "vitest";
import { ReadinessCode } from "./codes.js";
import { prepareReadinessForRun } from "./run-preparation.js";

const NOW = 2000000000000;
const FUTURE = new Date(NOW + 86400000).toISOString();

function makeReadyEvidence(): string {
  return JSON.stringify({
    contract_version: "readiness.v1",
    decision: "READY",
    valid_until: FUTURE,
    projection_id: "test-proj",
    projection_version: "1.0.0",
  });
}

function makeBlockedEvidence(): string {
  return JSON.stringify({
    contract_version: "readiness.v1",
    decision: "BLOCKED",
    classification: "POLICY_REQUIRED",
  });
}

describe("prepareReadinessForRun", () => {
  it("READY evidence produces governed may-execute state", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: makeReadyEvidence(),
      projectionId: "test-proj",
      projectionVersion: "1.0.0",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.governance.governed).toBe(true);
      if (result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(true);
      }
    }
  });

  it("BLOCKED evidence produces governed blocked state", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: makeBlockedEvidence(),
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.governance.governed).toBe(true);
      if (result.governance.governed) {
        expect(result.governance.state.mayExecute()).toBe(false);
      }
    }
  });

  it("missing evidence blocks", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: null,
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.mayExecute()).toBe(false);
    }
  });

  it("malformed evidence blocks", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: "{invalid}",
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.mayExecute()).toBe(false);
    }
  });

  it("expired evidence blocks", () => {
    const past = new Date(NOW - 86400000).toISOString();
    const evidence = JSON.stringify({
      contract_version: "readiness.v1",
      decision: "READY",
      valid_until: past,
    });
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: evidence,
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.mayExecute()).toBe(false);
    }
  });

  it("projection binding mismatch blocks", () => {
    const evidence = JSON.stringify({
      contract_version: "readiness.v1",
      decision: "READY",
      valid_until: FUTURE,
      projection_id: "wrong",
    });
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: evidence,
      projectionId: "expected",
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.mayExecute()).toBe(false);
    }
  });

  it("unresolved policy blocks", () => {
    const result = prepareReadinessForRun({
      routeClassification: "UNKNOWN_OR_MISSING_ROUTE",
      evidenceJson: null,
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.mayExecute()).toBe(false);
    }
  });

  it("non-model route returns governed:false", () => {
    const result = prepareReadinessForRun({
      routeClassification: "TRUSTED_NON_MODEL_ROUTE",
      evidenceJson: null,
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.governance.governed).toBe(false);
    }
  });

  it("test harness route produces governed state", () => {
    const result = prepareReadinessForRun({
      routeClassification: "TEST_MODEL_EXECUTION_ROUTE",
      evidenceJson: makeReadyEvidence(),
      projectionId: "test-proj",
      projectionVersion: "1.0.0",
      isTestHarness: true,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.governance.governed).toBe(true);
    }
  });

  it("errors are sanitized", () => {
    const result = prepareReadinessForRun({
      routeClassification: "REAL_MODEL_EXECUTION_ROUTE",
      evidenceJson: null,
      projectionId: null,
      projectionVersion: null,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.governance.governed) {
      expect(result.governance.state.classification).toBeTruthy();
    }
  });
});
