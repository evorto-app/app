# Track Spec: Bun-First Angular Alignment + Effect Runtime Consolidation

## Goal

Complete and harden the migration to a Bun-first Angular + Effect stack with no legacy Node/Express fallback behavior.

## Current Baseline

As of 2026-02-21, this track has already completed:

1. Bun-first package/runtime/tooling cutover for app, build, and test workflows.
2. Removal of Express runtime paths in favor of Effect Platform server composition.
3. Broad tRPC-to-Effect RPC migration across major application domains.
4. Shared server runtime composition where `/rpc` executes inside the same Effect runtime/layers as the main HTTP app.

## Source References

- `conductor/tracks/bun-angular-alignment_20260128/repomix-output-angular-bun-setup-main.zip.xml`
- `conductor/tracks/bun-angular-alignment_20260128/repomix-output-effect-angular-main (3).zip.xml`

These are implementation references only; repository code and track files are the source of truth.

## Remaining Scope

The remaining work for this track is production-hardening and closure:

1. Resolve remaining docs e2e instability.
2. Validate Bun `S3Client`/R2 behavior in a real configured environment.
3. Finalize session behavior decisions and verify production-like auth flows.
4. Complete focused test coverage for auth/session and webhook runtime paths.
5. Remove temporary dependency patching and close outstanding lint/toolchain anomalies.
6. Final full-gate validation and track closure documentation.

## Out of Scope

1. Backward compatibility with pre-migration Node/Express runtime behavior.
2. Reintroducing deprecated tRPC/Express architecture.

## Acceptance Criteria

1. All open items in `revisit-log.md` are closed or explicitly deferred with rationale.
2. `plan.md` accurately reflects completion state and remaining tasks.
3. Track docs reference only existing, current artifacts.
4. Final validation suite for this migration passes under Bun-first workflows.
