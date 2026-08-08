import { createHash } from "node:crypto";

export type CanonicalJsonFieldOrder = readonly (readonly [string, unknown])[];

export function serializeCanonicalJson(fields: CanonicalJsonFieldOrder): string {
  const parts: string[] = [];
  for (const [key, value] of fields) {
    parts.push(`${JSON.stringify(key)}:${serializeCanonicalValue(value)}`);
  }
  return `{${parts.join(",")}}`;
}

function serializeCanonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error("canonical JSON numbers must be integers");
    }
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeCanonicalValue(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      parts.push(`${JSON.stringify(key)}:${serializeCanonicalValue(record[key])}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new Error("unsupported canonical JSON value type");
}

export function computeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function computeBytecount(bytes: Uint8Array): number {
  return bytes.byteLength;
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
