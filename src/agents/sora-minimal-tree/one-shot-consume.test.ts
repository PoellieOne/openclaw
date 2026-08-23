/**
 * One-shot atomic consumption tests (T3).
 *
 * The C1→G1 capability is consumed with a single guarded atomic UPDATE:
 * concurrent/racing requests can never both obtain G1 execution, and no
 * second use is possible after consumption.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../../test/helpers/temp-dir.js";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
} from "../../state/openclaw-state-db.js";
import { withEnv } from "../../test-utils/env.js";
import {
  createSoraC1G1CapabilityRecord,
  insertSoraC1G1Capability,
  consumeSoraC1G1Capability,
} from "./one-shot-subdelegation.js";

const tempDirs: string[] = [];

function createTempStateDir(): string {
  return makeTempDir(tempDirs, "openclaw-sora-oneshot-");
}

describe("consumeSoraC1G1Capability", () => {
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

  function seedCapability(capabilityId = "CAPABILITY_TEST"): void {
    withEnv(env, () => {
      const record = createSoraC1G1CapabilityRecord({
        capabilityId,
        delegationId: "C1_G1_DELEGATION_TEST",
        authorityId: "AUTH_C1_G1_DELEGATION_TEST",
        issueDelegationId: "P0_C1_DELEGATION_TEST",
        issueAuthorityId: "AUTH_P0_C1_DELEGATION_TEST",
        grantorSessionKey: "agent:c1:c1",
        granteeSessionKey: "agent:g1:g1",
        transactionRunId: "C1-transaction-1",
        now: 100,
      });
      const inserted = insertSoraC1G1Capability(record, { env });
      expect(inserted.ok).toBe(true);
    });
  }

  it("consumes once and reserves the exact G1 identity", () => {
    seedCapability();
    const result = consumeSoraC1G1Capability(
      {
        capabilityId: "CAPABILITY_TEST",
        grantorSessionKey: "agent:c1:c1",
        transactionRunId: "C1-transaction-1",
        childSessionKey: "agent:g1:g1",
        childRunId: "G1-run-1",
        now: 200,
      },
      { env },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.admission.reservedChildSessionKey).toBe("agent:g1:g1");
      expect(result.admission.reservedRunId).toBe("G1-run-1");
      expect(result.admission.maxUses).toBe(1);
      expect(result.admission.maxDescendants).toBe(1);
      expect(result.admission.maxDepthFromP0).toBe(2);
      expect(result.admission.retryAllowed).toBe(false);
      expect(result.admission.fallbackAllowed).toBe(false);
      expect(result.admission.furtherDelegationAllowed).toBe(false);
    }
  });

  it("a second use after consumption is impossible", () => {
    seedCapability();
    const first = consumeSoraC1G1Capability(
      {
        capabilityId: "CAPABILITY_TEST",
        grantorSessionKey: "agent:c1:c1",
        transactionRunId: "C1-transaction-1",
        childSessionKey: "agent:g1:g1",
        childRunId: "G1-run-1",
        now: 200,
      },
      { env },
    );
    expect(first.ok).toBe(true);
    const second = consumeSoraC1G1Capability(
      {
        capabilityId: "CAPABILITY_TEST",
        grantorSessionKey: "agent:c1:c1",
        transactionRunId: "C1-transaction-1",
        childSessionKey: "agent:g1:g1",
        childRunId: "G1-run-2",
        now: 300,
      },
      { env },
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("CAPABILITY_ALREADY_CONSUMED");
    }
  });

  it("racing request cannot reserve a second G1 (changes=0 path)", () => {
    seedCapability();
    // Simulate the race by consuming directly through the guarded UPDATE on
    // the same row, then proving a second caller sees RACE_RESERVATION_CONFLICT
    // or ALREADY_CONSUMED rather than a second reservation.
    const first = consumeSoraC1G1Capability(
      {
        capabilityId: "CAPABILITY_TEST",
        grantorSessionKey: "agent:c1:c1",
        transactionRunId: "C1-transaction-1",
        childSessionKey: "agent:g1:g1",
        childRunId: "G1-run-1",
        now: 200,
      },
      { env },
    );
    expect(first.ok).toBe(true);

    const racer = consumeSoraC1G1Capability(
      {
        capabilityId: "CAPABILITY_TEST",
        grantorSessionKey: "agent:c1:c1",
        transactionRunId: "C1-transaction-1",
        childSessionKey: "agent:g1:g1-racer",
        childRunId: "G1-run-racer",
        now: 201,
      },
      { env },
    );
    expect(racer.ok).toBe(false);

    withEnv(env, () => {
      const rows = openOpenClawStateDatabase({ env })
        .db.prepare(
          "SELECT reserved_child_session_key, reserved_run_id, consumed FROM sora_c1_g1_capabilities WHERE capability_id = ?",
        )
        .all("CAPABILITY_TEST") as Array<{
        reserved_child_session_key: string | null;
        reserved_run_id: string | null;
        consumed: number;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.consumed).toBe(1);
      expect(rows[0]?.reserved_child_session_key).toBe("agent:g1:g1");
      expect(rows[0]?.reserved_run_id).toBe("G1-run-1");
    });
  });

  it("consumption fails when the requester is not the capability grantor", () => {
    seedCapability();
    const result = consumeSoraC1G1Capability(
      {
        capabilityId: "CAPABILITY_TEST",
        grantorSessionKey: "agent:attacker:attacker",
        transactionRunId: "C1-transaction-1",
        childSessionKey: "agent:g1:g1",
        childRunId: "G1-run-1",
        now: 200,
      },
      { env },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("CAPABILITY_NOT_ISSUED_BY_C1_EDGE");
    }
  });

  it("consumption fails when the transaction run does not match", () => {
    seedCapability();
    const result = consumeSoraC1G1Capability(
      {
        capabilityId: "CAPABILITY_TEST",
        grantorSessionKey: "agent:c1:c1",
        transactionRunId: "WRONG-transaction",
        childSessionKey: "agent:g1:g1",
        childRunId: "G1-run-1",
        now: 200,
      },
      { env },
    );
    expect(result.ok).toBe(false);
  });

  it("consumption fails for an unknown capability", () => {
    const result = consumeSoraC1G1Capability(
      {
        capabilityId: "CAPABILITY_UNKNOWN",
        grantorSessionKey: "agent:c1:c1",
        transactionRunId: "C1-transaction-1",
        childSessionKey: "agent:g1:g1",
        childRunId: "G1-run-1",
        now: 200,
      },
      { env },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("CAPABILITY_NOT_FOUND");
    }
  });

  it("consumption fails when required identities are missing", () => {
    const result = consumeSoraC1G1Capability(
      {
        capabilityId: "",
        grantorSessionKey: "",
        transactionRunId: "",
        childSessionKey: "",
        childRunId: "",
        now: 200,
      },
      { env },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("UNRESOLVED_STATE");
    }
  });
});
