import { describe, it, expect, vi } from "vitest";
import { resolveGovernedProjection } from "./projection-resolver.js";
import type { GovernedReadinessProjection } from "./types.js";

function makeProjection(
  overrides?: Partial<GovernedReadinessProjection>,
): GovernedReadinessProjection {
  return {
    id: "proj-1",
    version: "v1",
    content: JSON.stringify({ contract_version: "readiness.v1", decision: "READY" }),
    ...overrides,
  };
}

describe("resolveGovernedProjection", () => {
  it("resolves exactly one projection", async () => {
    const loader = vi.fn().mockResolvedValue({ ok: true, projection: makeProjection() });
    const result = await resolveGovernedProjection({ loader });
    expect(result.ok).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("loader called exactly once", async () => {
    const loader = vi.fn().mockResolvedValue({ ok: true, projection: makeProjection() });
    await resolveGovernedProjection({ loader });
    await resolveGovernedProjection({ loader });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("rejects missing projection", async () => {
    const loader = vi
      .fn()
      .mockResolvedValue({ ok: false, code: "EVIDENCE_MISSING", message: "not found" });
    const result = await resolveGovernedProjection({ loader });
    expect(result.ok).toBe(false);
  });

  it("rejects empty id", async () => {
    const loader = vi.fn().mockResolvedValue({ ok: true, projection: makeProjection({ id: "" }) });
    const result = await resolveGovernedProjection({ loader });
    expect(result.ok).toBe(false);
  });

  it("rejects empty version", async () => {
    const loader = vi
      .fn()
      .mockResolvedValue({ ok: true, projection: makeProjection({ version: "" }) });
    const result = await resolveGovernedProjection({ loader });
    expect(result.ok).toBe(false);
  });

  it("rejects empty content", async () => {
    const loader = vi
      .fn()
      .mockResolvedValue({ ok: true, projection: makeProjection({ content: "" }) });
    const result = await resolveGovernedProjection({ loader });
    expect(result.ok).toBe(false);
  });

  it("rejects oversized content", async () => {
    const large = "x".repeat(70000);
    const loader = vi
      .fn()
      .mockResolvedValue({ ok: true, projection: makeProjection({ content: large }) });
    const result = await resolveGovernedProjection({ loader });
    expect(result.ok).toBe(false);
  });

  it("accepts content at size boundary", async () => {
    const boundary = "x".repeat(65535);
    const loader = vi
      .fn()
      .mockResolvedValue({ ok: true, projection: makeProjection({ content: boundary }) });
    const result = await resolveGovernedProjection({ loader });
    expect(result.ok).toBe(true);
  });

  it("rejects hash mismatch", async () => {
    const loader = vi
      .fn()
      .mockResolvedValue({ ok: true, projection: makeProjection({ contentHash: "abc" }) });
    const result = await resolveGovernedProjection({ loader, expectedContentHash: "def" });
    expect(result.ok).toBe(false);
  });

  it("accepts matching hash", async () => {
    const loader = vi
      .fn()
      .mockResolvedValue({ ok: true, projection: makeProjection({ contentHash: "abc" }) });
    const result = await resolveGovernedProjection({ loader, expectedContentHash: "abc" });
    expect(result.ok).toBe(true);
  });

  it("loader failure sanitized", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("disk error"));
    const result = await resolveGovernedProjection({ loader });
    expect(result.ok).toBe(false);
  });
});
