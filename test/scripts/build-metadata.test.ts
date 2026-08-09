// Functional tests for the central shell build-metadata provenance helpers.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const HELPER = path.join(process.cwd(), "scripts", "lib", "build-metadata.sh");
const BASH_BIN = process.platform === "win32" ? "bash" : "/bin/bash";
const tempDirs: string[] = [];

function makeRepository(): { root: string; commit: string; tree: string } {
  const root = mkdtempSync(path.join(tmpdir(), "openclaw-build-metadata-"));
  tempDirs.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.email", "build-metadata@openclaw.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "OpenClaw Build Metadata Test"], { cwd: root });
  writeFileSync(path.join(root, "tracked.txt"), "clean\n", "utf8");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "initial"], {
    cwd: root,
  });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  return { root, commit, tree };
}

function runHelper(root: string, env: Record<string, string> = {}, fn: string): string {
  const result = execFileSync(
    BASH_BIN,
    ["--noprofile", "--norc", "-c", `source "${HELPER}"; ${fn}`, "--", root],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ...env },
    },
  );
  return result.trim();
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("scripts/lib/build-metadata.sh", () => {
  it("accepts and normalizes an exact full tree from OPENCLAW_BUILD_TREE", () => {
    const repository = makeRepository();
    const result = runHelper(
      repository.root,
      { OPENCLAW_BUILD_TREE: repository.tree.toUpperCase() },
      'openclaw_resolve_git_tree "$1"',
    );

    expect(result).toBe(repository.tree);
  });

  it("resolves the exact HEAD tree from the same checkout as the commit", () => {
    const repository = makeRepository();
    const commit = runHelper(repository.root, {}, 'openclaw_resolve_git_commit "$1"');
    const tree = runHelper(repository.root, {}, 'openclaw_resolve_git_tree "$1"');

    expect(commit).toBe(repository.commit);
    expect(tree).toBe(repository.tree);
  });

  it("rejects a malformed explicit tree", () => {
    const repository = makeRepository();

    expect(() =>
      runHelper(
        repository.root,
        { OPENCLAW_BUILD_TREE: "abc1234" },
        'openclaw_resolve_git_tree "$1"',
      ),
    ).toThrow();
  });

  it("emits unknown without a checkout and fails closed when required", () => {
    const root = mkdtempSync(path.join(tmpdir(), "openclaw-build-metadata-empty-"));
    tempDirs.push(root);

    expect(runHelper(root, {}, 'openclaw_resolve_git_tree "$1"')).toBe("unknown");
    expect(() =>
      runHelper(root, { OPENCLAW_REQUIRE_BUILD_METADATA: "1" }, 'openclaw_resolve_git_tree "$1"'),
    ).toThrow();
  });
});
