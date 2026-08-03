import { describe, it, expect } from "vitest";
import { parseReadinessJson } from "./parser.js";

describe("parseReadinessJson", () => {
  it("accepts a valid simple object", () => {
    const result = parseReadinessJson('{"a":1}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it("rejects duplicate top-level key", () => {
    const result = parseReadinessJson('{"a":1,"a":2}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_KEY");
  });

  it("rejects duplicate nested key", () => {
    const result = parseReadinessJson('{"a":{"b":1,"b":2}}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_KEY");
  });

  it("accepts same key in separate objects", () => {
    const result = parseReadinessJson('{"a":{"b":1},"c":{"b":2}}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: { b: 1 }, c: { b: 2 } });
  });

  it("handles escaped quotes in keys", () => {
    const result = parseReadinessJson('{"a\\"b":1}');
    expect(result.ok).toBe(true);
  });

  it("handles escaped backslashes", () => {
    const result = parseReadinessJson('{"a\\\\b":1}');
    expect(result.ok).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const result = parseReadinessJson("{invalid}");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DUPLICATE_KEY");
  });

  it("rejects empty input", () => {
    const result = parseReadinessJson("");
    expect(result.ok).toBe(false);
  });

  it("rejects input exceeding size limit (UTF-8 bytes)", () => {
    const large = "{" + "a".repeat(65535) + "}";
    const result = parseReadinessJson(large);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MAXIMUM_SIZE_EXCEEDED");
  });

  it("accepts input at UTF-8 byte boundary", () => {
    const ascii = '{"a":"' + "x".repeat(65520) + '"}';
    const result = parseReadinessJson(ascii);
    expect(result.ok).toBe(true);
  });

  it("rejects multi-byte UTF-8 input above byte limit", () => {
    const multiByte = '{"a":"' + "\u4e2d".repeat(25000) + '"}';
    const result = parseReadinessJson(multiByte);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MAXIMUM_SIZE_EXCEEDED");
  });

  it("accepts multi-byte UTF-8 input within byte limit", () => {
    const multiByte = '{"a":"' + "\u4e2d".repeat(100) + '"}';
    const result = parseReadinessJson(multiByte);
    expect(result.ok).toBe(true);
  });

  it("rejects deeply nested objects exceeding depth limit", () => {
    const deep = buildDeepObject(10);
    const result = parseReadinessJson(deep);
    expect(result.ok).toBe(false);
  });

  it("accepts nested objects within depth limit", () => {
    const nested = buildDeepObject(7);
    const result = parseReadinessJson(nested);
    expect(result.ok).toBe(true);
  });

  it("accepts arrays", () => {
    const result = parseReadinessJson('{"a":[1,2,3]}');
    expect(result.ok).toBe(true);
  });

  it("accepts nested arrays", () => {
    const result = parseReadinessJson('{"a":[[1],[2]]}');
    expect(result.ok).toBe(true);
  });

  it("accepts whitespace", () => {
    const result = parseReadinessJson('  {  "a"  :  1  }  ');
    expect(result.ok).toBe(true);
  });

  it("rejects root that is not an object", () => {
    const result = parseReadinessJson('"string"');
    expect(result.ok).toBe(false);
  });

  it("rejects trailing content", () => {
    const result = parseReadinessJson('{"a":1} extra');
    expect(result.ok).toBe(false);
  });
});

function buildDeepObject(depth: number): string {
  let s = "";
  for (let i = 0; i < depth; i++) {
    s += `{"a":`;
  }
  s += "1";
  for (let i = 0; i < depth; i++) {
    s += "}";
  }
  return s;
}
