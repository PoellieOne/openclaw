import { describe, it, expect } from "vitest";
import { createBlockedResult, renderBlockedResult, isBlockedResult } from "./blocked-result.js";
import { ReadinessCode } from "./codes.js";

describe("blocked-result", () => {
  it("createBlockedResult returns a blocked result", () => {
    const result = createBlockedResult({
      classification: ReadinessCode.POLICY_UNRESOLVED,
      diagnosticRef: "test",
      evaluatedAt: 1000,
    });
    expect(result.isBlocked).toBe(true);
    expect(result.classification).toBe(ReadinessCode.POLICY_UNRESOLVED);
    expect(result.diagnosticRef).toBe("test");
    expect(result.evaluatedAt).toBe(1000);
  });

  it("renderBlockedResult returns sanitized message", () => {
    const result = createBlockedResult({
      classification: ReadinessCode.POLICY_UNRESOLVED,
      diagnosticRef: "test",
      evaluatedAt: 1000,
    });
    const rendered = renderBlockedResult(result);
    expect(rendered).toBeTruthy();
    expect(rendered.length).toBeLessThan(2048);
  });

  it("isBlockedResult identifies blocked results", () => {
    const result = createBlockedResult({
      classification: ReadinessCode.POLICY_UNRESOLVED,
      diagnosticRef: "test",
      evaluatedAt: 1000,
    });
    expect(isBlockedResult(result)).toBe(true);
    expect(isBlockedResult({})).toBe(false);
    expect(isBlockedResult(null)).toBe(false);
    expect(isBlockedResult("string")).toBe(false);
  });

  it("custom message is used when provided", () => {
    const result = createBlockedResult({
      classification: ReadinessCode.POLICY_UNRESOLVED,
      diagnosticRef: "test",
      evaluatedAt: 1000,
      customMessage: "Custom blocked message",
    });
    expect(renderBlockedResult(result)).toBe("Custom blocked message");
  });

  it("message is truncated if too long", () => {
    const long = "x".repeat(2000);
    const result = createBlockedResult({
      classification: ReadinessCode.POLICY_UNRESOLVED,
      diagnosticRef: "test",
      evaluatedAt: 1000,
      customMessage: long,
    });
    expect(renderBlockedResult(result).length).toBeLessThanOrEqual(1024);
  });

  it("result does not contain model output or assistant semantics", () => {
    const result = createBlockedResult({
      classification: ReadinessCode.POLICY_UNRESOLVED,
      diagnosticRef: "test",
      evaluatedAt: 1000,
    });
    expect(result.sanitizedMessage).not.toContain("Sophia");
    expect(result.sanitizedMessage).not.toContain("assistant");
  });
});
