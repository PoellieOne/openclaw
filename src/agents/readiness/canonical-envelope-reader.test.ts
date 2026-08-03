import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadCanonicalReadinessEnvelope } from "./canonical-envelope-reader.js";
import { ReadinessCode } from "./codes.js";

const TEST_FS_ADAPTER_KEY = Symbol.for("openclaw.readinessTestFsAdapter");

function setTestFsAdapter(adapter: unknown): void {
  const fn = (globalThis as Record<PropertyKey, unknown>)[TEST_FS_ADAPTER_KEY];
  if (typeof fn === "function") {
    (fn as (adapter: unknown) => void)(adapter);
  }
}

function makeReadyEnvelopeContent(): string {
  const { createHash } = require("node:crypto");
  const content = "Test projection content";
  const sha256 = createHash("sha256").update(Buffer.from(content, "utf-8")).digest("hex");
  return JSON.stringify({
    envelope_version: "readiness-envelope.v1",
    published_at: "2026-08-03T12:00:00.000Z",
    published_by: "test-agent",
    evidence: {
      contract_version: "readiness.v1",
      decision: "READY",
      valid_until: "2026-08-04T12:00:00.000Z",
      evaluated_at: "2026-08-03T12:00:00.000Z",
      projection_id: "test-projection-v1",
      projection_version: "1.0.0",
    },
    projection: {
      id: "test-projection-v1",
      version: "1.0.0",
      content,
    },
    binding: {
      kind: "sha256",
      projection_sha256: sha256,
    },
  });
}

function makeBlockedEnvelopeContent(): string {
  return JSON.stringify({
    envelope_version: "readiness-envelope.v1",
    published_at: "2026-08-03T12:00:00.000Z",
    published_by: "test-agent",
    evidence: {
      contract_version: "readiness.v1",
      decision: "BLOCKED",
    },
  });
}

describe("loadCanonicalReadinessEnvelope", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "readiness-test-"));
    setTestFsAdapter(undefined);
  });

  afterEach(() => {
    setTestFsAdapter(undefined);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function makeAdapterForFile(filePath: string) {
    return {
      openSync: (p: string, flags: number) => {
        if (p !== "/state/sora/readiness/current.json") {
          const e = new Error("ENOENT") as NodeJS.ErrnoException;
          e.code = "ENOENT";
          throw e;
        }
        return fs.openSync(filePath, flags);
      },
      fstatSync: (fd: number) => fs.fstatSync(fd),
      readSync: (fd: number, buffer: Buffer, offset: number, length: number, position: number) =>
        fs.readSync(fd, buffer, offset, length, position),
      closeSync: (fd: number) => fs.closeSync(fd),
      constants: fs.constants,
    };
  }

  describe("with real filesystem via adapter", () => {
    it("returns EVIDENCE_MISSING when file does not exist", () => {
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.EVIDENCE_MISSING);
      }
    });

    it("returns EVIDENCE_MALFORMED for a directory", () => {
      const dirPath = path.join(tmpDir, "current.json");
      fs.mkdirSync(dirPath);
      setTestFsAdapter(makeAdapterForFile(dirPath));
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.EVIDENCE_MALFORMED);
      }
    });

    it("returns MAXIMUM_SIZE_EXCEEDED for oversized file", () => {
      const filePath = path.join(tmpDir, "current.json");
      fs.writeFileSync(filePath, "x".repeat(262145), "utf-8");
      setTestFsAdapter(makeAdapterForFile(filePath));
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.MAXIMUM_SIZE_EXCEEDED);
      }
    });

    it("returns EVIDENCE_MISSING for empty file", () => {
      const filePath = path.join(tmpDir, "current.json");
      fs.writeFileSync(filePath, "", "utf-8");
      setTestFsAdapter(makeAdapterForFile(filePath));
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.EVIDENCE_MISSING);
      }
    });

    it("returns EVIDENCE_MALFORMED for leading UTF-8 BOM", () => {
      const filePath = path.join(tmpDir, "current.json");
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const content = makeBlockedEnvelopeContent();
      fs.writeFileSync(filePath, Buffer.concat([bom, Buffer.from(content, "utf-8")]));
      setTestFsAdapter(makeAdapterForFile(filePath));
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.EVIDENCE_MALFORMED);
      }
    });

    it("returns EVIDENCE_MALFORMED for invalid UTF-8", () => {
      const filePath = path.join(tmpDir, "current.json");
      fs.writeFileSync(filePath, Buffer.from([0x80, 0x80, 0x80]));
      setTestFsAdapter(makeAdapterForFile(filePath));
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.EVIDENCE_MALFORMED);
      }
    });

    it("accepts valid READY envelope", () => {
      const filePath = path.join(tmpDir, "current.json");
      fs.writeFileSync(filePath, makeReadyEnvelopeContent(), "utf-8");
      setTestFsAdapter(makeAdapterForFile(filePath));
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.evidence.decision).toBe("READY");
        expect(result.projection).toBeDefined();
        expect(result.projection.content).toBe("Test projection content");
      }
    });

    it("accepts valid BLOCKED envelope", () => {
      const filePath = path.join(tmpDir, "current.json");
      fs.writeFileSync(filePath, makeBlockedEnvelopeContent(), "utf-8");
      setTestFsAdapter(makeAdapterForFile(filePath));
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.evidence.decision).toBe("BLOCKED");
      }
    });
  });

  describe("with test fs adapter", () => {
    it("returns INTERNAL_EVALUATION_FAILURE_SANITIZED when O_NOFOLLOW unavailable", () => {
      setTestFsAdapter({
        openSync: fs.openSync,
        fstatSync: fs.fstatSync,
        readSync: fs.readSync,
        closeSync: fs.closeSync,
        constants: { ...fs.constants, O_NOFOLLOW: undefined as unknown as number },
      });
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED);
      }
    });

    it("returns EVIDENCE_MALFORMED for ELOOP (symlink)", () => {
      const mockFs = {
        openSync: () => {
          const e = new Error("symlink") as NodeJS.ErrnoException;
          e.code = "ELOOP";
          throw e;
        },
        fstatSync: fs.fstatSync,
        readSync: fs.readSync,
        closeSync: fs.closeSync,
        constants: fs.constants,
      };
      setTestFsAdapter(mockFs);
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.EVIDENCE_MALFORMED);
      }
    });

    it("returns EVIDENCE_MISSING for ENOENT", () => {
      const mockFs = {
        openSync: () => {
          const e = new Error("not found") as NodeJS.ErrnoException;
          e.code = "ENOENT";
          throw e;
        },
        fstatSync: fs.fstatSync,
        readSync: fs.readSync,
        closeSync: fs.closeSync,
        constants: fs.constants,
      };
      setTestFsAdapter(mockFs);
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.EVIDENCE_MISSING);
      }
    });

    it("returns INTERNAL_EVALUATION_FAILURE_SANITIZED for EACCES", () => {
      const mockFs = {
        openSync: () => {
          const e = new Error("permission denied") as NodeJS.ErrnoException;
          e.code = "EACCES";
          throw e;
        },
        fstatSync: fs.fstatSync,
        readSync: fs.readSync,
        closeSync: fs.closeSync,
        constants: fs.constants,
      };
      setTestFsAdapter(mockFs);
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED);
      }
    });

    it("returns INTERNAL_EVALUATION_FAILURE_SANITIZED for EPERM", () => {
      const mockFs = {
        openSync: () => {
          const e = new Error("operation not permitted") as NodeJS.ErrnoException;
          e.code = "EPERM";
          throw e;
        },
        fstatSync: fs.fstatSync,
        readSync: fs.readSync,
        closeSync: fs.closeSync,
        constants: fs.constants,
      };
      setTestFsAdapter(mockFs);
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED);
      }
    });

    it("handles multiple partial reads accumulated correctly", () => {
      const content = makeReadyEnvelopeContent();
      const buf = Buffer.from(content, "utf-8");
      let callCount = 0;
      const mockFs = {
        openSync: () => 3,
        fstatSync: () => ({ isFile: () => true, size: buf.length }),
        readSync: (
          _fd: number,
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          callCount++;
          const half = Math.ceil(length / 2);
          const end = Math.min(position + half, buf.length);
          const bytesToCopy = end - position;
          buf.copy(buffer, offset, position, end);
          return bytesToCopy;
        },
        closeSync: () => {},
        constants: fs.constants,
      };
      setTestFsAdapter(mockFs);
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(true);
      expect(callCount).toBeGreaterThan(1);
    });

    it("returns INTERNAL_EVALUATION_FAILURE_SANITIZED for premature EOF", () => {
      const content = makeReadyEnvelopeContent();
      const buf = Buffer.from(content, "utf-8");
      const mockFs = {
        openSync: () => 3,
        fstatSync: () => ({ isFile: () => true, size: buf.length }),
        readSync: () => 0,
        closeSync: () => {},
        constants: fs.constants,
      };
      setTestFsAdapter(mockFs);
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED);
      }
    });

    it("returns INTERNAL_EVALUATION_FAILURE_SANITIZED for file shrink", () => {
      const content = makeReadyEnvelopeContent();
      const buf = Buffer.from(content, "utf-8");
      let fstatCallCount = 0;
      const mockFs = {
        openSync: () => 3,
        fstatSync: () => {
          fstatCallCount++;
          return { isFile: () => true, size: fstatCallCount === 1 ? buf.length : buf.length - 1 };
        },
        readSync: (
          _fd: number,
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          const end = Math.min(position + length, buf.length);
          const bytesToCopy = end - position;
          buf.copy(buffer, offset, position, end);
          return bytesToCopy;
        },
        closeSync: () => {},
        constants: fs.constants,
      };
      setTestFsAdapter(mockFs);
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED);
      }
    });

    it("returns INTERNAL_EVALUATION_FAILURE_SANITIZED for file growth", () => {
      const content = makeReadyEnvelopeContent();
      const buf = Buffer.from(content, "utf-8");
      let fstatCallCount = 0;
      const mockFs = {
        openSync: () => 3,
        fstatSync: () => {
          fstatCallCount++;
          return { isFile: () => true, size: fstatCallCount === 1 ? buf.length : buf.length + 1 };
        },
        readSync: (
          _fd: number,
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          const end = Math.min(position + length, buf.length);
          const bytesToCopy = end - position;
          buf.copy(buffer, offset, position, end);
          return bytesToCopy;
        },
        closeSync: () => {},
        constants: fs.constants,
      };
      setTestFsAdapter(mockFs);
      const result = loadCanonicalReadinessEnvelope();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED);
      }
    });

    it("closes descriptor after every failure path", () => {
      let closed = false;
      const mockFs = {
        openSync: () => 3,
        fstatSync: () => ({ isFile: () => false, size: 100 }),
        readSync: fs.readSync,
        closeSync: () => {
          closed = true;
        },
        constants: fs.constants,
      };
      setTestFsAdapter(mockFs);
      loadCanonicalReadinessEnvelope();
      expect(closed).toBe(true);
    });

    it("closes descriptor after success", () => {
      const content = makeReadyEnvelopeContent();
      const buf = Buffer.from(content, "utf-8");
      let closed = false;
      const mockFs = {
        openSync: () => 3,
        fstatSync: () => ({ isFile: () => true, size: buf.length }),
        readSync: (
          _fd: number,
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          const end = Math.min(position + length, buf.length);
          const bytesToCopy = end - position;
          buf.copy(buffer, offset, position, end);
          return bytesToCopy;
        },
        closeSync: () => {
          closed = true;
        },
        constants: fs.constants,
      };
      setTestFsAdapter(mockFs);
      loadCanonicalReadinessEnvelope();
      expect(closed).toBe(true);
    });
  });
});
