/**
 * B3-T2: CONCURRENT DUPLICATE ISSUANCE (true process-level contention).
 *
 * Two competing OS processes attempt an equivalent governed issuance against
 * the SAME SQLite database at the same time. Exactly one may commit as valid;
 * the loser must observe `issuance-scope-already-issued` and materialize
 * NO second grant/readiness/edge/capability. Verified by persisted row
 * counts, not merely returned booleans.
 *
 * This uses real concurrent processes (spawnSync-based) so the BEGIN
 * IMMEDIATE + guarded insert + partial UNIQUE index single-winner behavior
 * is exercised under actual contention rather than fake interleaving.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../../test/helpers/temp-dir.js";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
} from "../../state/openclaw-state-db.js";

const tempDirs: string[] = [];

function createTempStateDir(): string {
  return makeTempDir(tempDirs, "openclaw-sora-b3t2-");
}

const REPO_ROOT = path.resolve(new URL("../../..", import.meta.url).pathname);

function runSeed(stateDir: string): void {
  const seedScript = `
    import path from "node:path";
    import { pathToFileURL } from "node:url";
    const repo = ${JSON.stringify(REPO_ROOT)};
    const { resolveC1DelegationAuthority } = await import(pathToFileURL(path.join(repo, "src/agents/sora-minimal-tree/delegation-edge.js")).href);
    const { createSoraDelegationEdge } = await import(pathToFileURL(path.join(repo, "src/agents/sora-minimal-tree/delegation-edge.js")).href);
    const c1 = resolveC1DelegationAuthority({
      delegationId: "P0_C1_DELEG",
      grantorSessionKey: "agent:p0:p0",
      granteeSessionKey: "agent:c1:c1",
      grantorTransactionRunId: "P0-run",
    });
    if (!c1.ok) {
      console.error("C1 derivation failed");
      process.exit(1);
    }
    const edge = createSoraDelegationEdge(
      {
        delegationId: "P0_C1_DELEG",
        grantorSessionKey: "agent:p0:p0",
        granteeSessionKey: "agent:c1:c1",
        grantorTransactionRunId: "P0-run",
        edgeKind: "P0_C1",
        authority: c1.authority,
        rootDelegationId: "P0_C1_DELEG",
      },
      { env: process.env },
    );
    if (!edge.ok) {
      console.error("EDGE failed: " + edge.reason);
      process.exit(1);
    }
    console.log("SEEDED");
  `;
  const seed = spawnSync(
    process.execPath,
    ["--input-type=module", "--import", "tsx", "-e", seedScript],
    { cwd: REPO_ROOT, env: { ...process.env, OPENCLAW_STATE_DIR: stateDir }, encoding: "utf8" },
  );
  if (seed.status !== 0) {
    throw new Error(`seed failed: ${seed.stderr ?? seed.stdout}`);
  }
}

function issueScript(stateDir: string): string {
  return `
    import path from "node:path";
    import { pathToFileURL } from "node:url";
    const repo = ${JSON.stringify(REPO_ROOT)};
    const { mintRuntimeGovernedParentHandleForTest } = await import(pathToFileURL(path.join(repo, "src/agents/sora-minimal-tree/governed-runtime-attachment.js")).href);
    const { createGovernedTransaction } = await import(pathToFileURL(path.join(repo, "src/agents/sora-minimal-tree/governed-transaction-controller.js")).href);
    const { issueGovernedSubdelegationGrant } = await import(pathToFileURL(path.join(repo, "src/agents/sora-minimal-tree/governed-subdelegation-issuance.js")).href);
    const handle = mintRuntimeGovernedParentHandleForTest({
      runId: "C1-RUN",
      sessionKey: "agent:c1:c1",
    });
    const transaction = createGovernedTransaction({ handle });
    const result = issueGovernedSubdelegationGrant(
      {
        handle,
        transaction,
        grant: {
          granteeSessionKey: "agent:g1:g1",
          holderSessionKey: "agent:holder:h1",
        },
      },
      { env: process.env },
    );
    console.log(
      "ISSUE=" +
        JSON.stringify({
          ok: result.ok,
          reason: result.ok ? "" : result.reason,
          grantId: result.ok ? result.grantId : "",
        }),
    );
  `;
}

function runIssuerAsync(stateDir: string): Promise<{ code: number | null; line: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--import", "tsx", "-e", issueScript(stateDir)],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, OPENCLAW_STATE_DIR: stateDir },
        encoding: "utf8",
      },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d: string) => {
      out += d;
    });
    child.stderr.on("data", (d: string) => {
      err += d;
    });
    child.on("close", (code) => {
      const line = out.split("\n").find((l) => l.startsWith("ISSUE=")) ?? "";
      resolve({ code, line: line.slice("ISSUE=".length) });
    });
    void err;
  });
}

describe("B3-T2 concurrent duplicate issuance (process-level contention)", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = createTempStateDir();
  });

  afterEach(() => {
    closeOpenClawStateDatabaseForTest();
  });

  afterAll(() => {
    cleanupTempDirs(tempDirs);
  });

  it("two competing equivalent issuances: exactly one valid commit", async () => {
    runSeed(stateDir);
    const [a, b] = await Promise.all([runIssuerAsync(stateDir), runIssuerAsync(stateDir)]);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    const parsed = [a.line, b.line].map((l) => JSON.parse(l) as { ok: boolean; reason?: string });
    const okCount = parsed.filter((p) => p.ok).length;
    expect(okCount).toBe(1);
    const loser = parsed.find((p) => !p.ok);
    expect(loser?.reason).toBe("issuance-scope-already-issued");

    // Persisted rows: exactly one grant/readiness/edge/capability/child txn.
    const db = openOpenClawStateDatabase({ env: { OPENCLAW_STATE_DIR: stateDir } });
    const grants = db.db
      .prepare("SELECT COUNT(*) AS c FROM governed_subdelegation_grants")
      .get() as { c: number };
    const readiness = db.db.prepare("SELECT COUNT(*) AS c FROM sora_edge_readiness").get() as {
      c: number;
    };
    const edges = db.db
      .prepare("SELECT COUNT(*) AS c FROM sora_delegation_edges WHERE edge_kind = 'C1_G1'")
      .get() as { c: number };
    const caps = db.db.prepare("SELECT COUNT(*) AS c FROM sora_c1_g1_capabilities").get() as {
      c: number;
    };
    const children = db.db
      .prepare("SELECT COUNT(*) AS c FROM governed_transaction_runs WHERE kind = 'CHILD'")
      .get() as { c: number };
    expect(grants.c).toBe(1);
    expect(readiness.c).toBe(1);
    expect(edges.c).toBe(1);
    expect(caps.c).toBe(1);
    expect(children.c).toBe(1);
  });
});
