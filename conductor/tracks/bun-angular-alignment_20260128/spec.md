# Track Spec: Align with fresh Angular + Bun baseline; introduce Effect across server

## Overview
Align the project with a fresh Angular CLI `ng new` setup using Bun as the package manager, remove Node/Express-based runtime parts, and introduce Effect-based code patterns across server, data access, and shared utilities while preserving existing SSR routes, RPC structure, and database schema.

## Functional Requirements
1. Baseline Alignment
   - Compare the current repo against a fresh Angular CLI project configured to use Bun.
   - Align configuration files and tooling to the fresh baseline where appropriate.
   - Consolidate scripts and lockfiles to Bun.

2. Runtime Migration
   - Remove Node/Express-based runtime code and wiring.
   - Ensure SSR server execution is Bun-first and continues to serve existing routes.

3. Effect Adoption
   - Introduce Effect across server RPC boundaries and shared utilities.
   - Use Drizzle's Effect/SQL integrations where applicable for server data access.

4. Compatibility Guarantees
   - Preserve existing SSR routes and public behavior.
   - Preserve RPC procedure structure and behavior.
   - Preserve database schema and migration setup.

## Non-Functional Requirements
- Maintain end-to-end type safety (Effect Schema, Drizzle types, Angular strict types).
- No regressions in SSR output or route handling.
- Keep changes aligned with current tech stack and Conductor workflow.

## Acceptance Criteria
- Project configuration and scripts match a fresh Angular CLI + Bun baseline where relevant.
- All Node/Express runtime artifacts are removed, and SSR runs on Bun.
- Effect is present and used across server, data access, and shared utilities.
- Existing SSR routes, RPC procedures, and database schema remain intact and functional.
- Build and lint still pass (as per project workflow gates).

## Out of Scope
- Product feature changes beyond migration/alignment work.
- Schema changes or new migrations.
- Large UI refactors unrelated to the alignment effort.
