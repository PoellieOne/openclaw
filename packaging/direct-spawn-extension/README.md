# Direct-Spawn Extension — Reproducible Image Build

## Purpose

Build a derived OpenClaw Docker image containing the generic
direct-subagent-spawn CLI extension (`openclaw spawn`).

## Architecture

STANDARD_PLUS_EXTERNAL_ADAPTER — OpenClaw is the standard outlet;
the direct-spawn CLI/service is one generic contact;
the external SoRa adapter is a separate plug outside OpenClaw.

## Pinned Source

- Baseline commit: `08987d8f409b848098156230b37916be6e4be5dd`
- Extension commit: `54bf5d24eb64f73af824abb12c2f54b7ffce12da`
- Extension tree: `40af64cee2fe3cc6445feb242c441cec4ffe0cb9`
- Source version: 2026.7.2
- Target compatibility: 2026.7.1

## Six-File Extension Scope

src/agents/direct-spawn.ts
src/agents/direct-spawn.test.ts
src/cli/spawn.ts
src/cli/spawn.test.ts
src/cli/program/subcli-descriptors.ts
src/cli/program/register.subclis-core.ts

## Corrected .dockerignore Rule

Use the exact pinned upstream .dockerignore from the extension commit.
Do NOT add patterns that exclude tracked source paths such as
`**/auth-profiles`, `**/state`, `state`, or `/state`.

## Deterministic Source Acquisition

```bash
git archive --format=tar 54bf5d24 | tar -xC $BUILD_CONTEXT_DIR
```

## Source Manifest Generation

```bash
cd $BUILD_CONTEXT_DIR
find . -type f ! -name 'source-manifest.sha256' \
  ! -name 'build-context-manifest.json' \
  ! -name 'build-derived-image.sh' \
  -print0 | sort -z | xargs -0 sha256sum > source-manifest.sha256
```

## Build-Context Manifest Generation

Create `build-context-manifest.json` with fields:

- schemaVersion, repository, baselineCommit, extensionCommit,
  extensionTree, sourcePackageVersion, targetCompatibility,
  sourceMethod, sourceFileCount, sourceBytecount,
  sourceManifestSha256, dockerfilePath, dockerfileSha256,
  dockerignoreSha256, lockfilePath, lockfileSha256,
  officialDockerfileSha256, expectedImageTag, buildCommand,
  nodeVersion, pnpmVersion, requiredMemory, requiredSwap,
  forbiddenInputs, packagingCorrection, packagingRevision,
  createdAtUtc

## Image Tag Convention

```
openclaw-sora-direct-spawn:2026.7.1-compatible-<short-commit>
```

## Build Command

```bash
docker build -f Dockerfile.direct-spawn \
  -t openclaw-sora-direct-spawn:2026.7.1-compatible-54bf5d24 \
  --build-arg GIT_COMMIT=54bf5d24eb64f73af824abb12c2f54b7ffce12da \
  .
```

## Provenance Labels

```
org.opencontainers.image.source=https://github.com/openclaw/openclaw
org.opencontainers.image.revision=54bf5d24...
org.opencontainers.image.version=2026.7.1-compatible-direct-spawn-54bf5d24
org.openclaw.baseline.commit=08987d8f...
org.openclaw.extension.commit=54bf5d24...
org.openclaw.extension.tree=40af64ce...
```

## Verification Steps

1. Verify image ID: `sha256:188c1e8db63275f5e6ea510309dc11e3dfea7163553c9803c74aed55bda7783a`
2. Verify OCI labels match provenance
3. Verify compiled spawn bundle using isolated CLI help probe:

```bash
timeout --signal=TERM --kill-after=5s 30s \
docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:noexec,nosuid,size=64m \
  --tmpfs /home/node:noexec,nosuid,size=64m \
  openclaw-sora-direct-spawn:2026.7.1-compatible-54bf5d24 \
  node openclaw.mjs spawn --help
```

This proves CLI help-surface reachability only.
It does not prove a real spawn transaction.

4. Verify no SoRa/S21/Sophia identifiers in dist

## Exclusions and Secret-Safety Rules

- No runtime config, credentials, sessions, transcripts in image
- No /state/sora artifacts
- No V5 image layers
- No provider secrets
- No Git metadata in runtime stage

## Evidence Distinction

- Source Git evidence: commit SHAs, tree SHAs, diff
- Build evidence: image ID, archive SHA-256, build log
- Runtime evidence: help-probe output, spawn results (separate phase)

## Rollback/Rebuild

Rebuild from the same pinned commits. No dependency on old V5 image
or active container filesystem.

## Git Remote Boundary

The local source branch must be pushed only to a verified
Ralph-controlled repository or fork.

The upstream OpenClaw remote is not an authorized push destination
without separately proven authority.
