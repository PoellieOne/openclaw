/**
 * Minimal-tree isolation tests.
 *
 * The bounded minimal-tree route must not alter ordinary S21/S22 spawn
 * behavior: spawns without the `sora` envelope take the ordinary admission
 * path, and the lazy-additive schema/index handling keeps existing
 * current-version state databases safe.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../../test/helpers/temp-dir.js";
import { LAZY_ADDITIVE_STATE_TABLES } from "../../state/openclaw-state-db-contract.js";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
} from "../../state/openclaw-state-db.js";
import { stripLazyAdditiveSchemaBlocks } from "../../state/openclaw-state-db.js";
import { OPENCLAW_STATE_SCHEMA_SQL } from "../../state/openclaw-state-schema.generated.js";
import { resolveSpawnAdmission } from "../spawn-plan.js";

const tempDirs: string[] = [];

function createTempStateDir(): string {
  return makeTempDir(tempDirs, "openclaw-sora-isolation-");
}

describe("minimal-tree isolation", () => {
  let stateDir: string;
  let env: { OPENCLAW_STATE_DIR: string };

  beforeEach(() => {
    stateDir = createTempStateDir();
    env = { OPENCLAW_STATE_DIR: stateDir };
  });

  afterEach(() => {
    closeOpenClawStateDatabaseForTest();
  });

  afterAll(() => {
    cleanupTempDirs(tempDirs);
  });

  it("ordinary spawn admission without the sora envelope is unchanged", () => {
    const cfg = {
      agents: {
        defaults: {
          subagents: {
            maxSpawnDepth: 1,
            maxChildrenPerAgent: 5,
          },
        },
      },
    } as never;

    const admission = resolveSpawnAdmission({
      cfg,
      requesterSessionKey: "agent:main:main",
      requesterAgentId: "main",
      targetAgentId: "main",
      configuredAgentIds: ["main"],
    });
    // Ordinary admission must succeed identically with or without the
    // minimal-tree surface present; the sora envelope is absent here.
    expect(admission.ok).toBe(true);
  });

  it("spawn admission with an incomplete sora envelope fails closed", () => {
    const cfg = {
      agents: {
        defaults: {
          subagents: {
            maxSpawnDepth: 1,
            maxChildrenPerAgent: 5,
          },
        },
      },
    } as never;

    const admission = resolveSpawnAdmission({
      cfg,
      requesterSessionKey: "agent:c1:c1",
      requesterAgentId: "c1",
      targetAgentId: "g1",
      configuredAgentIds: ["c1", "g1"],
      sora: {
        capabilityId: "CAPABILITY_TEST",
        delegationId: "C1_G1_DELEGATION_TEST",
        requesterTransactionRunId: "C1-transaction-1",
      },
    });
    // Without a persisted capability row the one-shot gate must fail closed.
    expect(admission.ok).toBe(false);
    if (!admission.ok) {
      expect(admission.error.length).toBeGreaterThan(0);
    }
  });

  it("existing current-version DB without lazy tables opens safely through the ordinary path", () => {
    fs.mkdirSync(path.join(stateDir, "state"), { recursive: true });
    const seeded = openOpenClawStateDatabase({ env });
    const tables = new Set(
      (
        seeded.db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    expect(tables.has("sora_delegation_edges")).toBe(true);

    // Drop the lazy tables and indexes to simulate an existing database
    // created before the minimal-tree feature shipped.
    seeded.db.exec("PRAGMA foreign_keys = OFF;");
    seeded.db.exec("DROP INDEX IF EXISTS idx_sora_canonicalization_grants_edge;");
    seeded.db.exec("DROP INDEX IF EXISTS idx_sora_integration_objects_child;");
    seeded.db.exec("DROP INDEX IF EXISTS idx_sora_capabilities_grantee;");
    seeded.db.exec("DROP INDEX IF EXISTS idx_sora_delegation_edges_grantee;");
    seeded.db.exec(
      "DROP TABLE sora_canonicalization_grants; DROP TABLE sora_integration_objects; DROP TABLE sora_c1_g1_capabilities; DROP TABLE sora_delegation_edges;",
    );
    seeded.db.exec("PRAGMA foreign_keys = ON;");
    seeded.db.exec("PRAGMA user_version = 6;");
    seeded.db.exec("PRAGMA integrity_check;");

    closeOpenClawStateDatabaseForTest();
    const reopened = openOpenClawStateDatabase({ env });
    expect(reopened.db.isOpen).toBe(true);
  });

  it("stripped schema never leaves dependent indexes behind", () => {
    const stripped = stripLazyAdditiveSchemaBlocks(OPENCLAW_STATE_SCHEMA_SQL);
    for (const tableName of LAZY_ADDITIVE_STATE_TABLES) {
      expect(stripped).not.toContain(`CREATE TABLE IF NOT EXISTS ${tableName} (`);
    }
    for (const indexName of [
      "idx_sora_delegation_edges_grantee",
      "idx_sora_capabilities_grantee",
      "idx_sora_integration_objects_child",
      "idx_sora_canonicalization_grants_edge",
    ]) {
      expect(stripped).not.toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`);
    }
  });
});
