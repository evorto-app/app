# Track Spec: Bun-First Angular Alignment + Effect Migration Foundation

## Overview

This track performs a Bun-first cutover for Evorto using the provided baseline reference in:

- `conductor/tracks/bun-angular-alignment_20260128/repomix-output-angular-bun-setup-main.zip.xml`
- `conductor/tracks/bun-angular-alignment_20260128/repomix-output-effect-angular-main.zip.xml`
- `conductor/tracks/bun-angular-alignment_20260128/codex-plan.md`

The migration mode is explicitly non-backward-compatible. We optimize for a clean Bun-first runtime/tooling path and then prepare for Effect-based RPC/data migrations.

## Functional Requirements

1. Bun Tooling and Package Manager Cutover
   - Replace Yarn-first workflows with Bun-first workflows.
   - Align `package.json` scripts with the Angular Bun baseline pattern (`bunx --bun ng`, Bun SSR serve command).
   - Use Bun lockfile/package manager metadata as source of truth.

2. Runtime Alignment
   - Ensure SSR startup and build are executable through Bun commands.
   - Remove Node-only script assumptions where Bun equivalents exist.

3. CI and Developer Workflow Alignment
   - Update CI workflows and local developer commands to run with Bun.
   - Keep required quality gates (lint/build/e2e/docs) runnable in Bun-first form.

4. Effect Migration Foundation
   - Preserve and reinforce Effect schema/type usage already present.
   - Prepare infrastructure for follow-up migration from tRPC/Express toward Effect HTTP + Effect RPC + Effect Postgres.
   - Use the repomix Effect Angular reference as implementation guidance, not as a direct code transplant.

## Non-Functional Requirements

- Maintain strict typing end-to-end.
- Keep Angular SSR behavior functionally stable for core user flows.
- Keep schema/migrations unchanged during Bun cutover work.
- Every completed milestone is committed for reviewability.

## Explicit Migration Policy

- Backward compatibility is not required for this track.
- Big-bang changes are allowed when they reduce migration complexity.
- If Bun runtime parity blocks progress, prioritize Bun-first tooling completion and document remaining runtime gaps in the plan.

## Acceptance Criteria

- `package.json` and workspace config are Bun-first and aligned with baseline intent.
- Yarn-specific package manager configuration is removed or made non-authoritative.
- CI paths use Bun install/run semantics.
- Core quality gates run successfully via Bun commands (at minimum lint + build during implementation milestones, full suite at final gate).
- Conductor artifacts (`spec.md`, `plan.md`, `tracks.md`) reflect actual migration execution status.

## Requirement-to-Test Mapping (Updated 2026-02-07)

- Bun runtime/tooling alignment:
  - `CI=true bun run lint:fix`
  - `CI=true bun run lint`
  - `CI=true bun run build`
  - `CI=true bun run test`
- Bun + Neon local e2e setup reliability:
  - `CI=true bun run docker:start`
  - `NO_WEBSERVER=true CI=true bunx --bun playwright test --project=setup --workers=1` (passes)
- Known remaining gate blocker before full e2e/docs close:
  - `NO_WEBSERVER=true CI=true bunx --bun playwright test --project=local-chrome --workers=1 --max-failures=1`
  - current first failure in `tests/specs/discounts/esn-discounts.test.ts` waiting for checkout link `Pay now`.

## Out of Scope (for this track phase)

- Product feature work unrelated to migration.
- Database schema redesign.
- Large UI refactors not required for Bun/Effect migration.
