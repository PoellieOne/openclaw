import fs from "node:fs";
import { ReadinessCode } from "./codes.js";
import { parseReadinessEnvelope, parseReadinessEnvelopeV2 } from "./envelope-parser.js";
import type {
  CanonicalReadinessEnvelopeLoadResult,
  V2CanonicalReadinessEnvelopeLoadResult,
} from "./envelope-parser.js";

const CANONICAL_READINESS_PATH = "/state/sora/readiness/current.json";
const MAX_ENVELOPE_BYTES = 262144;

type FsAdapter = {
  openSync: typeof fs.openSync;
  fstatSync: typeof fs.fstatSync;
  readSync: typeof fs.readSync;
  closeSync: typeof fs.closeSync;
  constants: typeof fs.constants;
};

const productionFs: FsAdapter = {
  openSync: fs.openSync,
  fstatSync: fs.fstatSync,
  readSync: fs.readSync,
  closeSync: fs.closeSync,
  constants: fs.constants,
};

let testFs: FsAdapter | undefined;

const TEST_FS_ADAPTER_KEY = Symbol.for("openclaw.readinessTestFsAdapter");

function setTestFsAdapter(adapter: FsAdapter | undefined): void {
  testFs = adapter;
}

if (typeof process !== "undefined" && (process.env.VITEST || process.env.NODE_ENV === "test")) {
  (globalThis as Record<PropertyKey, unknown>)[TEST_FS_ADAPTER_KEY] = setTestFsAdapter;
}

function getFs(): FsAdapter {
  return testFs ?? productionFs;
}

function rejectLeadingBOM(
  buffer: Buffer,
): { ok: true } | { ok: false; code: string; message: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      ok: false,
      code: ReadinessCode.EVIDENCE_MALFORMED,
      message: "UTF-8 BOM is not allowed",
    };
  }
  return { ok: true };
}

export function loadCanonicalReadinessEnvelope(): CanonicalReadinessEnvelopeLoadResult {
  const f = getFs();

  if (typeof f.constants.O_NOFOLLOW !== "number") {
    return {
      ok: false,
      code: ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED,
      message: "platform does not support O_NOFOLLOW",
    };
  }

  let fd: number | undefined;
  try {
    fd = f.openSync(CANONICAL_READINESS_PATH, f.constants.O_RDONLY | f.constants.O_NOFOLLOW);
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ELOOP") {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "symlink not allowed",
      };
    }
    if (nodeErr.code === "ENOENT") {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MISSING,
        message: "canonical envelope not found",
      };
    }
    return {
      ok: false,
      code: ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED,
      message: "failed to open canonical envelope",
    };
  }

  try {
    const before = f.fstatSync(fd);

    if (!before.isFile()) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "not a regular file",
      };
    }

    if (before.size <= 0) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MISSING,
        message: "empty envelope",
      };
    }

    if (before.size > MAX_ENVELOPE_BYTES) {
      return {
        ok: false,
        code: ReadinessCode.MAXIMUM_SIZE_EXCEEDED,
        message: "envelope exceeds maximum size",
      };
    }

    const buffer = Buffer.alloc(before.size);
    let offset = 0;

    while (offset < buffer.length) {
      const count = f.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (count === 0) {
        return {
          ok: false,
          code: ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED,
          message: "envelope read truncated",
        };
      }
      offset += count;
    }

    const after = f.fstatSync(fd);
    if (after.size !== before.size) {
      return {
        ok: false,
        code: ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED,
        message: "envelope size changed during read",
      };
    }

    const bomResult = rejectLeadingBOM(buffer);
    if (!bomResult.ok) {
      return bomResult;
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "invalid UTF-8 in envelope",
      };
    }

    return parseReadinessEnvelope(text);
  } finally {
    if (fd !== undefined) {
      try {
        f.closeSync(fd);
      } catch {
        // ignore close errors
      }
    }
  }
}

export function loadCanonicalReadinessEnvelopeV2(): V2CanonicalReadinessEnvelopeLoadResult {
  const f = getFs();

  if (typeof f.constants.O_NOFOLLOW !== "number") {
    return {
      ok: false,
      code: ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED,
      message: "platform does not support O_NOFOLLOW",
    };
  }

  let fd: number | undefined;
  try {
    fd = f.openSync(CANONICAL_READINESS_PATH, f.constants.O_RDONLY | f.constants.O_NOFOLLOW);
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ELOOP") {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "symlink not allowed",
      };
    }
    if (nodeErr.code === "ENOENT") {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MISSING,
        message: "canonical envelope not found",
      };
    }
    return {
      ok: false,
      code: ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED,
      message: "failed to open canonical envelope",
    };
  }

  try {
    const before = f.fstatSync(fd);

    if (!before.isFile()) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "not a regular file",
      };
    }

    if (before.size <= 0) {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MISSING,
        message: "empty envelope",
      };
    }

    if (before.size > MAX_ENVELOPE_BYTES) {
      return {
        ok: false,
        code: ReadinessCode.MAXIMUM_SIZE_EXCEEDED,
        message: "envelope exceeds maximum size",
      };
    }

    const buffer = Buffer.alloc(before.size);
    let offset = 0;

    while (offset < buffer.length) {
      const count = f.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (count === 0) {
        return {
          ok: false,
          code: ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED,
          message: "envelope read truncated",
        };
      }
      offset += count;
    }

    const after = f.fstatSync(fd);
    if (after.size !== before.size) {
      return {
        ok: false,
        code: ReadinessCode.INTERNAL_EVALUATION_FAILURE_SANITIZED,
        message: "envelope size changed during read",
      };
    }

    const bomResult = rejectLeadingBOM(buffer);
    if (!bomResult.ok) {
      return bomResult;
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      return {
        ok: false,
        code: ReadinessCode.EVIDENCE_MALFORMED,
        message: "invalid UTF-8 in envelope",
      };
    }

    return parseReadinessEnvelopeV2(text);
  } finally {
    if (fd !== undefined) {
      try {
        f.closeSync(fd);
      } catch {
        // ignore close errors
      }
    }
  }
}
