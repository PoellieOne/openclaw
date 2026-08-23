/**
 * Regression: an existing current-version state database without the
 * minimal-tree lazy-additive tables must still initialize/open safely
 * through the ordinary shared-state open path, without attempting to create
 * dependent indexes against absent lazy tables.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir, cleanupTempDirs } from "../../test/helpers/temp-dir.js";
import { LAZY_ADDITIVE_STATE_TABLES } from "./openclaw-state-db-contract.js";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
  OPENCLAW_STATE_SCHEMA_VERSION,
  stripLazyAdditiveSchemaBlocks,
} from "./openclaw-state-db.js";
import { resolveOpenClawStateSqlitePath } from "./openclaw-state-db.paths.js";
import { OPENCLAW_STATE_SCHEMA_SQL } from "./openclaw-state-schema.generated.js";

const SORA_LAZY_TABLES = [
  "sora_delegation_edges",
  "sora_c1_g1_capabilities",
  "sora_integration_objects",
  "sora_canonicalization_grants",
] as const;

const SORA_LAZY_INDEXES = [
  "idx_sora_delegation_edges_grantee",
  "idx_sora_capabilities_grantee",
  "idx_sora_integration_objects_child",
  "idx_sora_canonicalization_grants_edge",
] as const;

const SORA_B1_LAZY_INDEXES = [
  "idx_governed_transaction_runs_parent",
  "idx_authoritative_caller_bindings_session",
  "idx_governed_subdelegation_grants_grantee",
  // Partial UNIQUE index backing the B1 single-issuance-scope invariant; it
  // must be stripped together with its lazy-additive table so an existing
  // current-version DB without the sora tables can still run the eager DDL.
  "idx_governed_subdelegation_grants_issuance_scope",
  "idx_sora_edge_readiness_grant",
] as const;

const tempDirs: string[] = [];

function createTempStateDir(): string {
  return makeTempDir(tempDirs, "openclaw-state-lazy-schema-");
}

function sqliteStateDir(stateDir: string): string {
  return path.join(stateDir, "state");
}

describe("lazy additive schema stripping for current-version state databases", () => {
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

  it("strips dependent indexes together with lazy-additive table DDL", () => {
    const stripped = stripLazyAdditiveSchemaBlocks(OPENCLAW_STATE_SCHEMA_SQL);

    for (const tableName of SORA_LAZY_TABLES) {
      expect(stripped).not.toContain(`CREATE TABLE IF NOT EXISTS ${tableName} (`);
    }
    for (const indexName of SORA_LAZY_INDEXES) {
      expect(stripped).not.toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`);
    }
    for (const indexName of SORA_B1_LAZY_INDEXES) {
      expect(stripped).not.toContain(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName}`);
      expect(stripped).not.toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`);
    }
    // Ordinary eager tables must survive stripping untouched.
    expect(stripped).toContain("CREATE TABLE IF NOT EXISTS audit_events (");
    expect(stripped).toContain("CREATE TABLE IF NOT EXISTS schema_meta (");
  });

  it("runs the stripped eager DDL successfully against an existing current-version DB that lacks the lazy tables", () => {
    const env = { OPENCLAW_STATE_DIR: stateDir };
    fs.mkdirSync(sqliteStateDir(stateDir), { recursive: true });
    void resolveOpenClawStateSqlitePath(env);

    // Build a current-version state database via the ordinary open path.
    closeOpenClawStateDatabaseForTest();
    const seeded = openOpenClawStateDatabase({ env });
    seeded.db.exec(`PRAGMA user_version = ${OPENCLAW_STATE_SCHEMA_VERSION};`);
    const seededSchema = new Set(
      (
        seeded.db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    for (const tableName of SORA_LAZY_TABLES) {
      expect(seededSchema.has(tableName)).toBe(true);
    }

    // Simulate an existing current-version database created before the lazy
    // tables were added: drop the tables and their indexes, keep the version.
    seeded.db.exec("PRAGMA foreign_keys = OFF;");
    seeded.db.exec("DROP INDEX IF EXISTS idx_sora_canonicalization_grants_edge;");
    seeded.db.exec("DROP INDEX IF EXISTS idx_sora_integration_objects_child;");
    seeded.db.exec("DROP INDEX IF EXISTS idx_sora_capabilities_grantee;");
    seeded.db.exec("DROP INDEX IF EXISTS idx_sora_delegation_edges_grantee;");
    seeded.db.exec(
      "DROP TABLE sora_canonicalization_grants; DROP TABLE sora_integration_objects; DROP TABLE sora_c1_g1_capabilities; DROP TABLE sora_delegation_edges;",
    );
    seeded.db.exec("PRAGMA foreign_keys = ON;");
    seeded.db.exec(`PRAGMA user_version = ${OPENCLAW_STATE_SCHEMA_VERSION};`);
    seeded.db.exec("PRAGMA integrity_check;");

    // Reopen through the ordinary state open path. Before the correction this
    // failed: the eager schema executed `CREATE INDEX` against the stripped
    // lazy tables, which are absent in this existing database.
    closeOpenClawStateDatabaseForTest();
    const reopened = openOpenClawStateDatabase({ env });
    expect(reopened.db.isOpen).toBe(true);

    const finalSchema = new Set(
      (
        reopened.db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    expect(finalSchema.has("audit_events")).toBe(true);
    expect(finalSchema.has("schema_meta")).toBe(true);
    const lazyTablesStillAbsent = SORA_LAZY_TABLES.every((name) => !finalSchema.has(name));
    expect(lazyTablesStillAbsent).toBe(true);
  });

  it("keeps lazy tables available when the eager path is not used (full schema)", () => {
    // The generated schema source still carries the lazy tables and indexes.
    for (const tableName of SORA_LAZY_TABLES) {
      expect(OPENCLAW_STATE_SCHEMA_SQL).toContain(`CREATE TABLE IF NOT EXISTS ${tableName} (`);
    }
    for (const indexName of SORA_LAZY_INDEXES) {
      expect(OPENCLAW_STATE_SCHEMA_SQL).toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`);
    }
    expect(LAZY_ADDITIVE_STATE_TABLES).toEqual(expect.arrayContaining([...SORA_LAZY_TABLES]));
  });
});
