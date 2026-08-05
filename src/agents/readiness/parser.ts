import { ReadinessCode } from "./codes.js";

const MAX_INPUT_SIZE = 65536;
const MAX_DEPTH = 8;

export type ReadinessParseSuccess = {
  ok: true;
  value: unknown;
};

export type ReadinessParseError = {
  ok: false;
  code: string;
  message: string;
  position?: number;
};

export type ReadinessParseResult = ReadinessParseSuccess | ReadinessParseError;

function isWhitespace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

export function parseReadinessJson(input: string): ReadinessParseResult {
  if (new TextEncoder().encode(input).length > MAX_INPUT_SIZE) {
    return {
      ok: false,
      code: ReadinessCode.MAXIMUM_SIZE_EXCEEDED,
      message: "input exceeds maximum size",
    };
  }

  const chars = [...input];
  const len = chars.length;
  let pos = 0;

  function skipWhitespace(): void {
    while (pos < len && isWhitespace(chars[pos]!.charCodeAt(0))) {
      pos++;
    }
  }

  function peek(): string | null {
    skipWhitespace();
    return pos < len ? chars[pos]! : null;
  }

  function expect(c: string): boolean {
    skipWhitespace();
    if (pos < len && chars[pos] === c) {
      pos++;
      return true;
    }
    return false;
  }

  function parseString(): string | null {
    if (peek() !== '"') return null;
    pos++;
    let result = "";
    while (pos < len) {
      const ch = chars[pos];
      if (ch === '"') {
        pos++;
        return result;
      }
      if (ch === "\\") {
        pos++;
        if (pos >= len) return null;
        const esc = chars[pos];
        if (esc === "u") {
          if (pos + 4 >= len) return null;
          const hex = chars.slice(pos + 1, pos + 5).join("");
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
          result += String.fromCharCode(parseInt(hex, 16));
          pos += 5;
        } else {
          result += esc;
          pos++;
        }
      } else if (ch === "\n" || ch === "\r") {
        return null;
      } else {
        result += ch;
        pos++;
      }
    }
    return null;
  }

  function scanValue(depth: number): boolean {
    if (depth > MAX_DEPTH) return false;
    const c = peek();
    if (c === null) return false;
    if (c === '"') return parseString() !== null;
    if (c === "{") return scanObject(depth);
    if (c === "[") return scanArray(depth);
    if (c === "-" || (c >= "0" && c <= "9")) return scanNumber();
    if (c === "t" || c === "f" || c === "n") return scanKeyword();
    return false;
  }

  function scanNumber(): boolean {
    if (pos < len && chars[pos]! === "-") pos++;
    if (pos >= len || chars[pos]! < "0" || chars[pos]! > "9") return false;
    while (pos < len && chars[pos]! >= "0" && chars[pos]! <= "9") pos++;
    if (pos < len && chars[pos]! === ".") {
      pos++;
      if (pos >= len || chars[pos]! < "0" || chars[pos]! > "9") return false;
      while (pos < len && chars[pos]! >= "0" && chars[pos]! <= "9") pos++;
    }
    if (pos < len && (chars[pos]! === "e" || chars[pos]! === "E")) {
      pos++;
      if (pos < len && (chars[pos]! === "+" || chars[pos]! === "-")) pos++;
      if (pos >= len || chars[pos]! < "0" || chars[pos]! > "9") return false;
      while (pos < len && chars[pos]! >= "0" && chars[pos]! <= "9") pos++;
    }
    return true;
  }

  function scanKeyword(): boolean {
    if (
      pos + 4 <= len &&
      chars[pos] === "t" &&
      chars[pos + 1] === "r" &&
      chars[pos + 2] === "u" &&
      chars[pos + 3] === "e"
    ) {
      pos += 4;
      return true;
    }
    if (
      pos + 5 <= len &&
      chars[pos] === "f" &&
      chars[pos + 1] === "a" &&
      chars[pos + 2] === "l" &&
      chars[pos + 3] === "s" &&
      chars[pos + 4] === "e"
    ) {
      pos += 5;
      return true;
    }
    if (
      pos + 4 <= len &&
      chars[pos] === "n" &&
      chars[pos + 1] === "u" &&
      chars[pos + 2] === "l" &&
      chars[pos + 3] === "l"
    ) {
      pos += 4;
      return true;
    }
    return false;
  }

  function scanObject(depth: number): boolean {
    if (peek() !== "{") return false;
    pos++;
    const seenKeys = new Set<string>();
    let first = true;
    while (true) {
      skipWhitespace();
      if (peek() === "}") {
        pos++;
        return true;
      }
      if (!first) {
        if (!expect(",")) return false;
        skipWhitespace();
        if (peek() === "}") return false;
      }
      first = false;
      const key = parseString();
      if (key === null) return false;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      if (!expect(":")) return false;
      if (!scanValue(depth + 1)) return false;
    }
  }

  function scanArray(depth: number): boolean {
    if (peek() !== "[") return false;
    pos++;
    let first = true;
    while (true) {
      skipWhitespace();
      if (peek() === "]") {
        pos++;
        return true;
      }
      if (!first) {
        if (!expect(",")) return false;
        skipWhitespace();
        if (peek() === "]") return false;
      }
      first = false;
      if (!scanValue(depth + 1)) return false;
    }
  }

  skipWhitespace();
  if (pos >= len) {
    return { ok: false, code: ReadinessCode.EVIDENCE_MALFORMED, message: "empty input" };
  }

  if (peek() !== "{") {
    return { ok: false, code: ReadinessCode.EVIDENCE_MALFORMED, message: "root must be an object" };
  }

  if (!scanObject(0)) {
    return {
      ok: false,
      code: ReadinessCode.DUPLICATE_KEY,
      message: "duplicate key or malformed structure",
      position: pos,
    };
  }

  skipWhitespace();
  if (pos !== len) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "trailing content after root",
    };
  }

  try {
    const value = JSON.parse(input);
    return { ok: true, value };
  } catch {
    return { ok: false, code: ReadinessCode.EVIDENCE_MALFORMED, message: "JSON parse failed" };
  }
}
