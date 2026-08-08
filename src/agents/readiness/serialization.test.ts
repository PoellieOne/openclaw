import { describe, it, expect } from "vitest";
import {
  computeBytecount,
  computeSha256,
  encodeUtf8,
  serializeCanonicalJson,
} from "./serialization.js";

const FIELDS = [
  ["schema_version", "semantic-projection-payload.v1"],
  ["payload_id", "canonical-production-sophia-semantic-runtime-projection-v1"],
  ["payload_version", "1.0.0"],
  ["active_presence", "GENERAL_COLLABORATIVE_PRESENCE"],
  ["provider_policy", "openai"],
  ["model_policy", "openai/gpt-5.6-sol"],
  ["fallback_policy", "PROHIBITED"],
  ["bytecount", 1024],
  ["enabled", true],
  ["nothing", null],
] as const;

describe("serialization", () => {
  it("produces identical exact bytes for identical input", () => {
    const a = serializeCanonicalJson(FIELDS);
    const b = serializeCanonicalJson(FIELDS);
    expect(a).toBe(b);
    expect(encodeUtf8(a)).toEqual(encodeUtf8(b));
  });

  it("uses deterministic explicit key order", () => {
    const out = serializeCanonicalJson(FIELDS);
    expect(out.indexOf('"schema_version"')).toBeLessThan(out.indexOf('"payload_id"'));
    expect(out.indexOf('"payload_id"')).toBeLessThan(out.indexOf('"payload_version"'));
    expect(out.indexOf('"payload_version"')).toBeLessThan(out.indexOf('"active_presence"'));
  });

  it("emits compact JSON without whitespace", () => {
    const out = serializeCanonicalJson(FIELDS);
    expect(out).not.toMatch(/\s/);
    expect(out.startsWith("{")).toBe(true);
    expect(out.endsWith("}")).toBe(true);
  });

  it("emits no BOM and no trailing newline", () => {
    const out = serializeCanonicalJson(FIELDS);
    expect(out.charCodeAt(0)).not.toBe(0xfeff);
    expect(out.endsWith("\n")).toBe(false);
    expect(out.endsWith("\r\n")).toBe(false);
  });

  it("preserves Unicode code points without normalization", () => {
    const out = serializeCanonicalJson([["label", "caf\u00e9 \u4e2d\u6587 \ud83d\ude00"]]);
    expect(out).toBe('{"label":"caf\u00e9 \u4e2d\u6587 \ud83d\ude00"}');
    expect(out).toContain("\u00e9");
    expect(out).toContain("\u4e2d");
    expect(out).toContain("\ud83d\ude00");
  });

  it("computes SHA-256 over the exact serialized bytes", () => {
    const out = serializeCanonicalJson(FIELDS);
    const bytes = encodeUtf8(out);
    const digest = computeSha256(bytes);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const expected = computeSha256(encodeUtf8(out));
    expect(digest).toBe(expected);
  });

  it("computes bytecount as the exact UTF-8 byte length", () => {
    const out = serializeCanonicalJson(FIELDS);
    const bytes = encodeUtf8(out);
    expect(computeBytecount(bytes)).toBe(bytes.byteLength);
    expect(computeBytecount(bytes)).toBe(new TextEncoder().encode(out).byteLength);
  });

  it("produces different bytes for schema-relevant input differences", () => {
    const base = serializeCanonicalJson(FIELDS);
    const changed = serializeCanonicalJson([
      ...FIELDS.slice(0, 5),
      ["model_policy", "openai/gpt-5.6-sol"],
      ["fallback_policy", "ALLOWED"],
    ]);
    expect(changed).not.toBe(base);
    const reordered = serializeCanonicalJson([...FIELDS].reverse());
    expect(reordered).not.toBe(base);
  });

  it("rejects non-integer numbers", () => {
    expect(() => serializeCanonicalJson([["value", 1.5]])).toThrow(
      "canonical JSON numbers must be integers",
    );
  });

  it("serializes nested objects with sorted keys and arrays in input order", () => {
    const out = serializeCanonicalJson([
      ["nested", { z: 1, a: 2 }],
      ["list", ["b", "a", "c"]],
    ]);
    expect(out).toBe('{"nested":{"a":2,"z":1},"list":["b","a","c"]}');
  });
});
