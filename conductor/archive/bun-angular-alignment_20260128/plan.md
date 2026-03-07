# Implementation Plan

## Status Summary

- Migration state: **in progress (hardening/closure phase)**
- Architecture state: **Bun + Effect runtime cutover completed**
- Remaining work: **stability, validation, and cleanup closure**

## Phase 1: Completed Migration Foundations

- [x] Bun package manager and script alignment.
- [x] CI/dev workflow migration to Bun-first commands.
- [x] Express runtime decommission and Effect Platform server adoption.
- [x] Broad domain migration from tRPC paths to Effect RPC paths.
- [x] Shared runtime consolidation: `/rpc` now executes in the same Effect runtime/layer graph as the main server routes.

## Phase 2: Active Hardening Tasks

- [ ] Fix remaining docs failures:
  - `tests/docs/finance/inclusive-tax-rates.doc.ts`
  - `tests/docs/profile/discounts.doc.ts`
- [ ] Validate Bun `S3Client` + R2 upload and signed preview behavior with real R2 credentials.
- [ ] Decide and validate final Auth0 session-refresh/session-shape behavior under production-like payloads.
- [ ] Revisit security-header strictness (`Permissions-Policy`, `X-Frame-Options`) with current UX/integration requirements.
- [ ] Add focused tests for auth callback/session lifecycle and Stripe webhook runtime behavior.
- [ ] Replace temporary `@material/material-color-utilities` patch dependency with an upstream-safe solution.
- [ ] Resolve/diagnose `bun run lint:check` / `bunx ng lint` unknown-error toolchain failure mode.

## Phase 3: Closure Gate

- [ ] Run final validation gate on Bun-first workflows (lint/build/unit/e2e/docs e2e).
- [ ] Close or explicitly defer every remaining item in `revisit-log.md`.
- [ ] Mark track metadata/docs as complete and prepare closure handoff.

## Working Rules

1. Keep this file concise and current; avoid session-chatter history.
2. Record unresolved follow-ups in `revisit-log.md` only.
3. Commit milestones as isolated, reviewable units.
