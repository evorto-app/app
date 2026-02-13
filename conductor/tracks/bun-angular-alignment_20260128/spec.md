# Track Spec: Bun-First Angular Alignment + Effect Migration Foundation

## Overview

This track performs a Bun-first cutover for Evorto using the provided baseline reference in:

- `conductor/tracks/bun-angular-alignment_20260128/repomix-output-angular-bun-setup-main.zip.xml`
- `conductor/tracks/bun-angular-alignment_20260128/repomix-output-effect-angular-effect-angular-query-v0.1.1.zip.xml`
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

## Requirement-to-Test Mapping (Updated 2026-02-12)

- Bun runtime/tooling alignment:
  - `CI=true bun run lint:fix`
  - `CI=true bun run lint`
  - `CI=true bun run build`
  - `CI=true bun run test`
- Bun + Neon local e2e setup reliability:
  - `CI=true bun run docker:start`
  - `NO_WEBSERVER=true CI=true bunx --bun playwright test --project=setup --workers=1` (passes)
- Local-chrome discounts checkout reliability:
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && NO_WEBSERVER=true CI=true bunx --bun playwright test tests/specs/discounts/esn-discounts.test.ts --project=local-chrome --workers=1 --max-failures=1'`
  - verified passing in repeated runs after stabilizing `registerForEvent` + discounts test selector/wait handling.
- Template CRUD reliability under Bun local runtime:
  - `CI=true bunx --bun playwright test tests/specs/templates/templates.test.ts --project=local-chrome --workers=1 --max-failures=1`
  - server-side template simple create/update now avoids transaction-specific Neon local websocket failures and persists `location` consistently.
- Documentation test stability for approval + profile discounts:
  - `CI=true bunx --bun playwright test tests/docs/events/event-approval.doc.ts tests/docs/profile/discounts.doc.ts --project=docs --workers=1 --max-failures=1`
  - verified deterministic selectors/navigation and seeded event data path.
- Final gate full-suite validation:
  - `CI=true bun run lint:fix`
  - `CI=true bun run lint`
  - `CI=true bun run build`
  - `CI=true bun run test`
  - `CI=true bun run e2e` (`65 passed`, `6 skipped`)
  - `CI=true bun run e2e:docs` (`23 passed`)
- Icons Effect RPC vertical slice validation:
  - `CI=true bun run lint:fix`
  - `CI=true bun run lint`
  - `CI=true bun run build`
  - `CI=true bun run test`
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/templates/templates.test.ts --project=local-chrome --workers=1 --max-failures=1'` (`11 passed`)
  - `CI=true bun run e2e:docs` (`23 passed`)
- Template categories Effect RPC vertical slice validation:
  - `CI=true bun run lint:fix`
  - `CI=true bun run lint`
  - `CI=true bun run build`
  - `CI=true bun run test`
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/templates/templates.test.ts --project=local-chrome --workers=1 --max-failures=1'` (`11 passed`)
  - `CI=true bun run e2e:docs` (`23 passed`)
- Templates grouped-by-category Effect RPC vertical slice validation:
  - `CI=true bun run lint:fix`
  - `CI=true bun run lint`
  - `CI=true bun run build`
  - `CI=true bun run test`
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/templates/templates.test.ts --project=local-chrome --workers=1 --max-failures=1'` (`11 passed`)
  - `CI=true bun run e2e:docs` (`23 passed`)
- Effect Angular Query v0.1.1 API migration validation:
  - `bunx --bun eslint` on all migrated files under `src/app/**` and `src/shared/rpc-contracts/app-rpcs.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/templates/templates.test.ts --project=local-chrome --workers=1 --max-failures=1'` (`11 passed`)
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/templates/templates.doc.ts --project=docs --workers=1 --max-failures=1'` (`8 passed`)
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
- Effect RPC auth/config wrapper removal validation:
  - `bunx --bun eslint` on `src/app/core/guards/auth.guard.ts`, `src/app/core/guards/user-account.guard.ts`, and `src/app/core/config.service.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/templates/templates.test.ts --project=local-chrome --workers=1 --max-failures=1'` (`11 passed`)
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
- Effect RPC `users.userAssigned` guard migration validation:
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
- Effect RPC `users.maybeSelf` + `users.self` + `users.updateProfile` migration validation:
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/profile/discounts.doc.ts --project=docs --workers=1 --max-failures=1'` (`8 passed`)
- Effect RPC `users.events.findMany` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/profile/user-profile/user-profile.component.ts src/server/trpc/users/users.router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/profile/discounts.doc.ts --project=docs --workers=1 --max-failures=1'` (`8 passed`)
- Effect RPC `users.authData` + `users.createAccount` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.web-handler.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/core/create-account/create-account.component.ts src/server/trpc/users/users.router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
- Angular tRPC client-injector decommission validation:
  - `bunx --bun eslint src/app/events/guards/event-edit.guard.ts src/app/events/guards/event-organizer.guard.ts src/app/shared/components/controls/role-select/role-select.component.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `rg -n "injectTRPCClient\\(" src/app` (no matches)
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
- Effect RPC `users.findMany` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/admin/user-list/user-list.component.ts src/server/trpc/users/users.router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
- Effect RPC `admin.roles.findMany/findOne/search` read migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/server/trpc/admin/role.router.ts src/app/admin/role-list/role-list.component.ts src/app/templates/template-create/template-create.component.ts src/app/admin/role-details/role-details.component.ts src/app/admin/role-edit/role-edit.component.ts src/app/admin/role-create/role-create.component.ts src/app/shared/components/controls/role-select/role-select.component.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/roles/roles.doc.ts --project=docs --workers=1 --max-failures=1'` (`8 passed`)
- Effect RPC `admin.roles.findHubRoles` read migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/server/trpc/admin/role.router.ts src/app/internal-pages/members-hub/members-hub.component.ts src/app/internal-pages/members-hub/members-hub.component.html src/app/admin/role-create/role-create.component.ts src/app/admin/role-edit/role-edit.component.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/roles/roles.doc.ts --project=docs --workers=1 --max-failures=1'` (`8 passed`)
- Effect RPC `admin.roles.create/update/delete` mutation migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/admin/role-create/role-create.component.ts src/app/admin/role-edit/role-edit.component.ts src/server/trpc/admin/admin.router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/roles/roles.doc.ts --project=docs --workers=1 --max-failures=1'` (`8 passed`)
- Effect RPC `admin.tenant` settings/tax-rates migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/admin/general-settings/general-settings.component.ts src/app/admin/tax-rates-settings/tax-rates-settings.component.ts src/app/admin/components/import-tax-rates-dialog/import-tax-rates-dialog.component.ts src/server/trpc/app-router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/finance/tax-rates/admin-import-tax-rates.spec.ts tests/docs/finance/inclusive-tax-rates.doc.ts --project=local-chrome --project=docs --workers=1 --max-failures=1'` (`11 passed`)
- Effect RPC `taxRates.listActive` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/templates/template-details/template-details.component.ts src/app/templates/shared/template-form/template-registration-option-form.component.ts src/app/shared/components/forms/registration-option-form/registration-option-form.ts src/server/trpc/app-router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/templates/paid-option-requires-tax-rate.spec.ts tests/docs/templates/templates.doc.ts --project=local-chrome --project=docs --workers=1 --max-failures=1'` (`8 passed`, `6 skipped`)
- Effect RPC `discounts.getTenantProviders` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/server/trpc/discounts/discounts.router.ts src/app/admin/general-settings/general-settings.component.ts src/app/events/event-edit/event-edit.ts src/app/templates/template-create-event/template-create-event.component.ts src/app/profile/user-profile/user-profile.component.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/profile/discounts.doc.ts tests/docs/templates/templates.doc.ts --project=docs --workers=1 --max-failures=1'` (`9 passed`)
- Effect RPC discounts-card procedure migration validation (`discounts.getMyCards`, `discounts.upsertMyCard`, `discounts.refreshMyCard`, `discounts.deleteMyCard`):
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/profile/user-profile/user-profile.component.ts src/app/profile/user-profile/user-profile.component.html src/app/events/event-details/event-details.component.ts src/server/trpc/app-router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/profile/discounts.doc.ts --project=docs --workers=1 --max-failures=1'` (`8 passed`)
  - `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/discounts/esn-discounts.test.ts --project=local-chrome --workers=1 --max-failures=1'` (`8 passed`; setup shows transient flaky retries in this environment)
- Effect RPC `editorMedia.createImageDirectUpload` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/shared/components/controls/editor/editor.component.ts src/server/trpc/app-router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
- Effect RPC `globalAdmin.tenants.findMany` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/global-admin/tenant-list/tenant-list.component.ts src/app/global-admin/tenant-list/tenant-list.component.html src/server/trpc/global-admin/tenant.router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
- Effect RPC `events.canOrganize` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/events/event-details/event-details.component.ts src/app/events/guards/event-organizer.guard.ts src/server/trpc/events/events.router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
- Effect RPC `events.getRegistrationStatus` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/events/event-details/event-details.component.ts src/app/events/event-registration-option/event-registration-option.component.ts src/app/events/event-active-registration/event-active-registration.component.ts src/server/trpc/events/events.router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
- Effect RPC `events.getPendingReviews` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/admin/admin-overview/admin-overview.component.ts src/app/admin/event-reviews/event-reviews.component.ts src/app/events/event-details/event-details.component.ts src/server/trpc/events/events.router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
- Effect RPC `events.eventList` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/events/event-list.service.ts src/app/events/event-list/event-list.component.ts src/app/events/event-list/event-list.component.html src/app/events/event-edit/event-edit.ts src/app/events/event-details/event-details.component.ts src/app/admin/event-reviews/event-reviews.component.ts src/app/templates/template-create-event/template-create-event.component.ts src/server/trpc/events/events.router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
- Effect RPC `events.findOneForEdit` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/events/event-edit/event-edit.ts src/server/trpc/events/events.router.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
- Effect RPC `events.findOne` + `events.getOrganizeOverview` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/server/trpc/events/events.router.ts src/app/events/event-details/event-details.component.ts src/app/events/event-organize/event-organize.ts src/app/events/guards/event-edit.guard.ts src/app/events/guards/event-organizer.guard.ts src/app/events/event-registration-option/event-registration-option.component.ts src/app/admin/event-reviews/event-reviews.component.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)
- Effect RPC `events.reviewEvent` + `events.submitForReview` + `events.updateListing` migration validation:
  - `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/server/trpc/events/events.router.ts src/app/events/event-details/event-details.component.ts src/app/admin/event-reviews/event-reviews.component.ts`
  - `bunx --bun tsc -p tsconfig.app.json --noEmit`
  - `bunx --bun tsc -p tsconfig.spec.json --noEmit`
  - `CI=true bun run lint` (warnings-only baseline unchanged)
  - `CI=true bun run build`
  - `CI=true bun run test` (`12 passed`)

## Out of Scope (for this track phase)

- Product feature work unrelated to migration.
- Database schema redesign.
- Large UI refactors not required for Bun/Effect migration.
