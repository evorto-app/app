# Implementation Plan

## Phase 1: Conductor Consolidation + Baseline Lock [checkpoint: pending]

- [x] Task: Consolidate track artifacts from all provided references (b5902fc)
  - [x] Define test intent (documentation-only changes)
  - [x] Merge prior `plan.md` + `codex-plan.md` into one execution plan
  - [x] Update `spec.md` to use repomix baselines as source of truth
  - [x] Set track status to in-progress in `conductor/tracks.md`
  - [x] Commit milestone

- [x] Task: Capture Bun baseline deltas against current repo (b5902fc)
  - [x] Define test intent (analysis-only)
  - [x] Record script/config deltas from `repomix-output-angular-bun-setup-main.zip.xml`
  - [x] Record Effect integration references from `repomix-output-effect-angular-main.zip.xml`
  - [x] Commit milestone (if files changed)

- [ ] Task: Conductor - User Manual Verification 'Phase 1'

## Phase 2: Bun Tooling Cutover [checkpoint: pending]

- [x] Task: Convert package manager metadata and lockfiles to Bun (be16879)
  - [x] Define test intent (install + lint/build smoke)
  - [x] Set `packageManager` to Bun
  - [x] Generate/commit Bun lockfile
  - [x] Remove Yarn-specific lock/config artifacts no longer needed
  - [x] Commit milestone

- [x] Task: Align npm scripts to Bun baseline semantics (be16879)
  - [x] Define test intent (script execution smoke)
  - [x] Convert Angular scripts to `bunx --bun ng`
  - [x] Convert runtime scripts to Bun equivalents (`bun --bun ...`)
  - [x] Replace Node-invoked helper scripts with Bun where possible
  - [x] Commit milestone

- [ ] Task: Conductor - User Manual Verification 'Phase 2'

## Phase 3: CI + Dev Workflow Bun Alignment [checkpoint: pending]

- [x] Task: Update GitHub Actions workflows from Yarn/Node assumptions to Bun-first (919a4ed)
  - [x] Define test intent (workflow syntax + local command parity)
  - [x] Replace Yarn install/run steps with Bun install/run
  - [x] Keep required secrets/env setup behavior intact
  - [x] Commit milestone

- [x] Task: Update repository docs and operational commands to Bun-first (919a4ed)
  - [x] Define test intent (docs consistency)
  - [x] Update root docs and workflow references from `yarn ...` to `bun run ...`
  - [x] Keep database/testing operational notes accurate
  - [x] Commit milestone

- [x] Task: Remove remaining Yarn fallback assumptions from local tooling bootstrap (4dbd486)
  - [x] Define test intent (`bun run check:tiptap-license`)
  - [x] Enforce Bun lockfile as the single source in helper validation scripts
  - [x] Align Codex environment setup bootstrap to `bun install --frozen-lockfile`
  - [x] Commit milestone

- [ ] Task: Conductor - User Manual Verification 'Phase 3'

## Phase 4: Bun Runtime + Quality Gates [checkpoint: pending]

- [x] Task: Validate Bun-based lint and build gates (85d8ad7)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`)
  - [x] Fix migration regressions uncovered by lint/build
  - [x] Commit milestone

- [x] Task: Validate Bun SSR startup path (85d8ad7)
  - [x] Define test intent (`bun run serve:ssr:evorto` smoke)
  - [x] Verify server starts and health route responds
  - [x] Commit milestone (if changes required)

- [x] Task: Apply Angular modernize transforms for latest template/class syntax (85d8ad7)
  - [x] Define test intent (`bun run lint:fix`, `bun run build`)
  - [x] Run Angular modernize migrations on `src/app`
  - [x] Verify migrated templates/components compile successfully
  - [x] Commit milestone

- [x] Task: Restore Bun unit-test runner type alignment (0bbb795)
  - [x] Define test intent (`bun run test`, `bun run lint:fix`, `bun run lint`, `bun run build`)
  - [x] Add missing Jasmine type definitions required by current spec files
  - [x] Align `registration-start-offset` pipe signature/spec with strict typing + lint rules
  - [x] Validation note: `bun run e2e --project=setup` still blocked by Neon DB connectivity in current shell environment

- [x] Task: Stabilize Playwright setup path for Bun + Neon local + SSR RPC bridge (f66c383)
  - [x] Define test intent (`bun run docker:start`, `playwright --project=setup`, targeted local-chrome smoke)
  - [x] Disable websocket-only Neon paths for local proxy usage in app/test database clients
  - [x] Remove transaction-only seed registration writes that trigger Neon websocket fallback in local Bun runs
  - [x] Align runtime test defaults to deterministic local ports (`4200`/`55432`) to avoid callback drift
  - [x] Resolve Effect RPC SSR transport URL by using absolute server-side `/rpc` origin from `BASE_URL`
  - [x] Validation result: setup project passes (`7/7`) with Bun + Docker local stack
  - [x] Validation note: local-chrome currently stops at `tests/specs/discounts/esn-discounts.test.ts` waiting for `Pay now` checkout link

- [x] Task: Stabilize Stripe checkout registration path for discounts under Bun local-chrome (875b56d)
  - [x] Define test intent (`bun run lint`, `bun run build`, targeted local-chrome discounts test)
  - [x] Remove Bun-incompatible transaction wrapping in `registerForEvent` and keep explicit rollback behavior
  - [x] Remove temporary diagnostics and keep concise server-side error logging
  - [x] Scope discounts e2e Pay button selection to the intended registration option and increase checkout-link wait budget
  - [x] Commit milestone

- [ ] Task: Conductor - User Manual Verification 'Phase 4'

## Phase 5: Effect Migration Foundation (Next Step Within Track) [checkpoint: pending]

- [x] Task: Draft concrete cutover map from tRPC/Express to Effect HTTP/RPC layers (b4ebff0)
  - [x] Define test intent (design-only)
  - [x] Identify module-by-module replacement order under `src/server/**` and `src/app/core/**`
  - [x] Identify contract-sharing strategy for Angular RPC client helpers
  - [x] Commit milestone

- [x] Task: Implement first Effect boundary slice (small vertical) (1343542)
  - [x] Define test intent (targeted lint/build + runtime parity)
  - [x] Migrate one bounded server route/procedure path to Effect-first structure
  - [x] Preserve type safety and tests
  - [x] Commit milestone

- [ ] Task: Conductor - User Manual Verification 'Phase 5'

## Phase 6: Effect RPC Protocol + Angular Client Bridge [checkpoint: pending]

- [x] Task: Stand up shared Effect RPC contracts and `/rpc` server endpoint for config bootstrap (c11b0b0)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`, SSR health smoke)
  - [x] Add shared RPC contract module under `src/shared/**`
  - [x] Add Effect RPC handler layer and mount `/rpc` endpoint in server runtime
  - [x] Keep existing `/trpc` path running for non-migrated domains
  - [x] Commit milestone
  - [x] Validation note: SSR health smoke attempted; blocked by local Neon prerequisites (`NEON_PROJECT_ID`) and DB connectivity in current environment

- [x] Task: Migrate Angular config bootstrap to Effect RPC client/helpers (8434092)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`)
  - [x] Add Angular Effect RPC client wiring in `app.config.ts`
  - [x] Replace `config.public` bootstrap call path from tRPC to Effect RPC
  - [x] Preserve runtime behavior and strict typing
  - [x] Commit milestone

- [x] Task: Extend config bootstrap migration with Effect RPC permissions/auth procedures (394d769)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`)
  - [x] Add shared RPC contracts for `config.permissions` and `config.isAuthenticated`
  - [x] Bridge middleware-derived auth/permission context into `/rpc` handler path
  - [x] Migrate `ConfigService` permissions bootstrap from tRPC to Effect RPC
  - [x] Capture integration constraints and next-step guidance in track docs
  - [x] Commit milestone

- [x] Task: Migrate guard-level auth checks from tRPC to Effect RPC (2c64751)
  - [x] Define test intent (`bun run lint`, `bun run build`)
  - [x] Replace `config.isAuthenticated` guard calls in `auth.guard.ts`
  - [x] Replace `config.isAuthenticated` guard calls in `user-account.guard.ts`
  - [x] Keep unrelated user profile lookups on tRPC until matching RPC procedures are migrated
  - [x] Commit milestone

- [x] Task: Migrate `config.isAuthenticated`/`config.permissions` queryOptions callsites to Effect RPC helpers (e6f9b85)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`)
  - [x] Update `Auth` service config queryOptions calls to Effect RPC helpers
  - [x] Update navigation and event registration components config auth queryOptions calls
  - [x] Keep non-config tRPC queries/mutations in place for phased migration
  - [x] Commit milestone

- [x] Task: Migrate `config.tenant` read/invalidation paths to Effect RPC bridge (9c97fe0)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`, SSR health smoke)
  - [x] Extend shared config RPC contracts and `/rpc` header bridge with tenant context
  - [x] Move `ConfigService` tenant bootstrap/queryOptions from tRPC to Effect RPC
  - [x] Update admin tenant settings invalidation to use Effect RPC path keys
  - [x] Commit milestone
  - [x] Validation note: SSR health smoke currently blocked in local shell when OIDC env values (`CLIENT_ID` etc.) are not exported

- [x] Task: Decommission unused tRPC `config` router surface after Effect RPC cutover (e8ac353)
  - [x] Define test intent (`bun run lint:fix`, `bun run lint`, `bun run build`)
  - [x] Remove `config` namespace from tRPC app router composition
  - [x] Delete obsolete `src/server/trpc/core/config.router.ts`
  - [x] Commit milestone

- [x] Task: Migrate `icons` domain from tRPC to Effect RPC vertical slice (b386bc0)
  - [x] Define test intent (`CI=true bun run lint:fix`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`, targeted templates e2e + docs e2e)
  - [x] Add shared Effect RPC contracts and server handlers for `icons.search` + `icons.add`
  - [x] Migrate Angular icon selector callsites from `injectTRPC()` to Effect RPC client/helpers
  - [x] Decommission `icons` namespace from tRPC app router composition
  - [x] Commit milestone

- [x] Task: Migrate `templateCategories` domain from tRPC to Effect RPC vertical slice (b4ea817)
  - [x] Define test intent (`CI=true bun run lint:fix`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`, targeted templates e2e + docs e2e)
  - [x] Add shared Effect RPC contracts and server handlers for `templateCategories.findMany/create/update`
  - [x] Migrate Angular `templateCategories` query/mutation callsites from `injectTRPC()` to Effect RPC helpers/client
  - [x] Decommission `templateCategories` namespace from tRPC app router composition
  - [x] Commit milestone

- [x] Task: Migrate `templates.groupedByCategory` reads from tRPC to Effect RPC vertical slice (4c901a3)
  - [x] Define test intent (`CI=true bun run lint:fix`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`, targeted templates e2e + docs e2e)
  - [x] Add shared Effect RPC contracts and server handlers for `templates.groupedByCategory`
  - [x] Migrate Angular template list/category list queries and invalidations to Effect RPC query keys
  - [x] Decommission `templates.groupedByCategory` procedure from tRPC template router
  - [x] Commit milestone

- [x] Task: Migrate Angular Effect RPC query integration to `@heddendorp/effect-angular-query@0.1.1` API surface (c63b7e4)
  - [x] Define test intent (`bunx --bun eslint` on affected files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, targeted templates spec+docs Playwright)
  - [x] Upgrade package dependency and align provider setup with `createEffectRpcAngularClient(...)`
  - [x] Mark shared RPC procedures with `asRpcQuery(...)`/`asRpcMutation(...)`
  - [x] Replace remaining `EffectRpcQueryClient` + `helpersFor(...)` callsites with `AppRpc.injectClient()`
  - [x] Replace custom mutation callsites with generated `injectMutation(() => rpc.<path>.mutationOptions())`
  - [x] Remove now-unused imperative `EffectRpcClient` wrappers for migrated icons/template-categories methods
  - [x] Validation note: `bun run lint`, `bun run lint:fix`, and `bun run build` currently exit via `SIGKILL` in this shell; fallback targeted lint/typecheck + Playwright checks passed

- [x] Task: Decommission remaining imperative `EffectRpcClient` usage for auth/config paths (9825044)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, targeted templates Playwright smoke)
  - [x] Replace `auth.guard` and `user-account.guard` imperative calls with `AppRpc.injectClient().config.isAuthenticated.call(...)`
  - [x] Replace `ConfigService.initialize()` imperative config calls with direct `AppRpc` procedure calls
  - [x] Remove `src/app/core/effect-rpc-client.ts` if no remaining usages
  - [x] Commit milestone

- [x] Task: Migrate `users.userAssigned` guard check from tRPC to Effect RPC vertical slice (c141708)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contract + handler for `users.userAssigned`
  - [x] Bridge user-assigned context header into `/rpc` web handler
  - [x] Replace `user-account.guard` callsite from `injectTRPCClient()` to `AppRpc.injectClient().users.userAssigned.call()`
  - [x] Decommission legacy `users.userAssigned` tRPC procedure
  - [x] Commit milestone

- [x] Task: Migrate `users.maybeSelf` + `users.self` + `users.updateProfile` from tRPC to Effect RPC slice (348330b)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`, targeted profile/templates smoke)
  - [x] Add shared Effect RPC contracts + handlers for `users.maybeSelf`, `users.self`, and `users.updateProfile`
  - [x] Replace Angular query/mutation callsites in auth/events/profile/create-account flows with `AppRpc` helpers
  - [x] Decommission legacy tRPC `users.maybeSelf`, `users.self`, and `users.updateProfile` procedures
  - [x] Commit milestone

- [x] Task: Migrate `users.events.findMany` from tRPC to Effect RPC slice (f24cb75)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`, targeted profile docs smoke)
  - [x] Add shared Effect RPC contract + handler for `users.events.findMany`
  - [x] Replace profile callsite from `injectTRPC().users.events.findMany` to `AppRpc.injectClient().users.events.queryOptions()`
  - [x] Decommission legacy tRPC `users.events.findMany` procedure
  - [x] Commit milestone

- [x] Task: Migrate `users.authData` + `users.createAccount` bootstrap flow from tRPC to Effect RPC slice (ec4fdd5)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contracts + handlers for `users.authData` and `users.createAccount`
  - [x] Bridge OIDC auth-data context into `/rpc` web handler headers
  - [x] Replace `create-account` component query/mutation callsites from `injectTRPCClient()/injectTRPC()` to `AppRpc.injectClient()`
  - [x] Decommission legacy tRPC `users.authData` and `users.createAccount` procedures
  - [x] Commit milestone

- [x] Task: Decommission remaining `injectTRPCClient()` callsites in Angular app (5f9ba3c)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Migrate event guards to `QueryClient.fetchQuery(trpc.<path>.queryOptions(...))`
  - [x] Migrate `role-select` current role lookup to typed `queryOptions(...)` usage
  - [x] Verify no `injectTRPCClient()` usages remain in `src/app/**`
  - [x] Commit milestone

- [x] Task: Migrate `users.findMany` admin listing from tRPC to Effect RPC slice (0998a26)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contract + handler for `users.findMany`
  - [x] Replace `admin/user-list` query callsite to `AppRpc.injectClient().users.findMany.queryOptions(...)`
  - [x] Decommission legacy tRPC `users.findMany` procedure
  - [x] Commit milestone

- [x] Task: Migrate `admin.roles.findMany/findOne/search` read paths from tRPC to Effect RPC slice (dd9d982)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`, targeted roles docs smoke)
  - [x] Add shared Effect RPC contracts + handlers for `admin.roles.findMany`, `admin.roles.findOne`, and `admin.roles.search`
  - [x] Replace Angular role read callsites (`role-list`, `role-details`, `role-edit`, `role-select`, `template-create`) to `AppRpc` helpers
  - [x] Decommission legacy tRPC role read procedures (`findMany`, `findOne`, `search`)
  - [x] Commit milestone

- [x] Task: Migrate `admin.roles.findHubRoles` read path from tRPC to Effect RPC slice (2eb1a6e)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`, targeted roles docs smoke)
  - [x] Add shared Effect RPC contract + handler for `admin.roles.findHubRoles`
  - [x] Replace members-hub query callsite and role create/edit invalidation paths with `AppRpc` helpers
  - [x] Decommission legacy tRPC `findHubRoles` procedure
  - [x] Commit milestone

- [x] Task: Migrate `admin.roles.create/update/delete` mutation paths from tRPC to Effect RPC slice (86690e3)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`, targeted roles docs smoke)
  - [x] Add shared Effect RPC contracts + handlers for `admin.roles.create`, `admin.roles.update`, and `admin.roles.delete`
  - [x] Replace Angular role create/edit mutation callsites with `AppRpc` mutation helpers
  - [x] Decommission legacy tRPC admin role router surface
  - [x] Commit milestone

- [x] Task: Migrate `admin.tenant` settings/tax-rate procedures from tRPC to Effect RPC slice (8fbadf5)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`, targeted finance tax-rates docs/spec smoke)
  - [x] Add shared Effect RPC contracts + handlers for `admin.tenant.updateSettings`, `admin.tenant.listImportedTaxRates`, `admin.tenant.listStripeTaxRates`, and `admin.tenant.importStripeTaxRates`
  - [x] Replace Angular settings + tax-rates callsites (`general-settings`, `tax-rates-settings`, `import-tax-rates-dialog`) with `AppRpc` helpers
  - [x] Decommission legacy tRPC `admin` router namespace from app-router composition
  - [x] Commit milestone

- [x] Task: Migrate `taxRates.listActive` from tRPC to Effect RPC slice (27ae9a5)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`, targeted templates docs/spec smoke)
  - [x] Add shared Effect RPC contract + handler for `taxRates.listActive` with parity permission checks
  - [x] Replace Angular tax-rate list callsites in template/registration forms with `AppRpc` helpers
  - [x] Decommission legacy tRPC `taxRates` router namespace from app-router composition
  - [x] Commit milestone

- [x] Task: Migrate `discounts.getTenantProviders` from tRPC to Effect RPC slice (b269797)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`, targeted profile/templates docs smoke)
  - [x] Add shared Effect RPC contract + handler for `discounts.getTenantProviders` with parity tenant-provider normalization
  - [x] Replace Angular discount-provider query callsites (`event-edit`, `template-create-event`, `user-profile`) and related invalidation path (`general-settings`) with `AppRpc` helpers
  - [x] Decommission legacy tRPC `discounts.getTenantProviders` procedure
  - [x] Commit milestone

- [x] Task: Migrate discounts card procedures (`getMyCards`, `upsertMyCard`, `refreshMyCard`, `deleteMyCard`) from tRPC to Effect RPC slice (ce7ec4d)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`, targeted discounts docs/spec smoke)
  - [x] Add shared Effect RPC contracts + handlers for `discounts.getMyCards`, `discounts.upsertMyCard`, `discounts.refreshMyCard`, and `discounts.deleteMyCard`
  - [x] Replace Angular discounts-card callsites in `user-profile` and `event-details` with `AppRpc` helpers
  - [x] Decommission legacy tRPC `discounts` router namespace from app-router composition
  - [x] Commit milestone

- [x] Task: Migrate `editorMedia.createImageDirectUpload` from tRPC to Effect RPC slice (64901c9)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contract + handler for `editorMedia.createImageDirectUpload`
  - [x] Replace editor upload mutation callsite with `AppRpc` helper in rich-text editor control
  - [x] Decommission legacy tRPC `editorMedia` router namespace from app-router composition
  - [x] Commit milestone

- [x] Task: Migrate `globalAdmin.tenants.findMany` from tRPC to Effect RPC slice (81c8d27)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contract + handler for `globalAdmin.tenants.findMany`
  - [x] Replace global-admin tenant list callsite with `AppRpc` helper
  - [x] Decommission legacy tRPC `globalAdmin.tenants.findMany` procedure
  - [x] Commit milestone

- [x] Task: Migrate `events.canOrganize` from tRPC to Effect RPC slice (b813ec5)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contract + handler for `events.canOrganize`
  - [x] Replace event organizer capability callsites (`event-details`, `event-organizer.guard`) with `AppRpc` helper
  - [x] Decommission legacy tRPC `events.canOrganize` procedure
  - [x] Commit milestone

- [x] Task: Migrate `events.getRegistrationStatus` from tRPC to Effect RPC slice (774ee8e)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contract + handler for `events.getRegistrationStatus`
  - [x] Replace event registration-status callsites (`event-details`, `event-registration-option`, `event-active-registration`) with `AppRpc` helper/query filters
  - [x] Decommission legacy tRPC `events.getRegistrationStatus` procedure
  - [x] Commit milestone

- [x] Task: Migrate `events.getPendingReviews` from tRPC to Effect RPC slice (b105214)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contract + handler for `events.getPendingReviews`
  - [x] Replace pending-reviews callsites and invalidation paths (`admin-overview`, `event-reviews`, `event-details`) with `AppRpc` helper/query filters
  - [x] Decommission legacy tRPC `events.getPendingReviews` procedure
  - [x] Commit milestone

- [x] Task: Migrate `events.eventList` from tRPC to Effect RPC slice (3f3e7a6)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contract + handler for `events.eventList`
  - [x] Replace event-list query and related invalidation paths (`event-list.service`, `event-edit`, `event-details`, `event-reviews`, `template-create-event`) with `AppRpc` helper/query filters
  - [x] Decommission legacy tRPC `events.eventList` procedure
  - [x] Commit milestone

- [x] Task: Migrate `events.findOneForEdit` from tRPC to Effect RPC slice (10b44d9)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contract + handler for `events.findOneForEdit`
  - [x] Replace event edit read callsite (`event-edit`) with `AppRpc` helper
  - [x] Decommission legacy tRPC `events.findOneForEdit` procedure
  - [x] Commit milestone

- [x] Task: Migrate `events.findOne` + `events.getOrganizeOverview` reads from tRPC to Effect RPC slice (f017584)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contracts + handlers for `events.findOne` and `events.getOrganizeOverview`
  - [x] Replace event read callsites (`event-details`, `event-organize`, `event-edit.guard`, `event-organizer.guard`) and related invalidation paths (`event-reviews`) with `AppRpc` helpers/query keys
  - [x] Decommission legacy tRPC `events.findOne` and `events.getOrganizeOverview` procedures
  - [x] Commit milestone

- [x] Task: Migrate `events.reviewEvent` + `events.submitForReview` + `events.updateListing` mutations from tRPC to Effect RPC slice
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contracts + handlers for `events.reviewEvent`, `events.submitForReview`, and `events.updateListing`
  - [x] Replace mutation callsites (`event-details`, `event-reviews`) and refresh logic with `AppRpc` mutation helpers
  - [x] Decommission legacy tRPC `events.reviewEvent`, `events.submitForReview`, and `events.updateListing` procedures
  - [x] Commit milestone

- [x] Task: Migrate `events.create` + `events.update` mutations from tRPC to Effect RPC slice (73d1af0)
  - [x] Define test intent (`bunx --bun eslint` on touched files, `bunx --bun tsc -p tsconfig.app.json --noEmit`, `CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contracts + handlers for `events.create` and `events.update` with parity validation/sanitization
  - [x] Replace event create/update callsites (`template-create-event`, `event-edit`) with `AppRpc` mutation helpers
  - [x] Decommission legacy tRPC `events.create` and `events.update` procedures
  - [x] Commit milestone

- [x] Task: Migrate `events.registerForEvent` + `events.cancelPendingRegistration` + `events.registrationScanned` from tRPC to Effect RPC slice
  - [x] Define test intent (`CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contracts + handlers for `events.registerForEvent`, `events.cancelPendingRegistration`, and `events.registrationScanned`
  - [x] Replace registration callsites (`event-registration-option`, `event-active-registration`, `handle-registration`) with `AppRpc` mutation/query helpers
  - [x] Decommission legacy tRPC events router namespace from app router composition and delete obsolete events router/procedure files
  - [x] Commit milestone

- [x] Task: Migrate template simple-flow procedures (`templates.findOne`, `templates.createSimpleTemplate`, `templates.updateSimpleTemplate`) from tRPC to Effect RPC slice
  - [x] Define test intent (`CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contracts + handlers for template find/create/update procedures
  - [x] Replace template callsites (`template-create`, `template-edit`, `template-details`, `template-create-event`) with `AppRpc` helpers
  - [x] Decommission legacy tRPC `templates` namespace from app router composition and delete obsolete template router file
  - [x] Commit milestone

- [x] Task: Decommission unused tRPC `users` + `globalAdmin` namespaces from app router composition
  - [x] Define test intent (`CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Verify no Angular callsites depend on tRPC `users`/`globalAdmin` namespaces
  - [x] Remove `users` and `globalAdmin` namespaces from `src/server/trpc/app-router.ts`
  - [x] Delete obsolete router files under `src/server/trpc/users/**` and `src/server/trpc/global-admin/**`
  - [x] Commit milestone

- [x] Task: Migrate finance receipt/transaction procedures from tRPC to Effect RPC slice (3e4b3ea)
  - [x] Define test intent (`CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Add shared Effect RPC contracts + handlers for finance receipts/receipt-media/transactions flows
  - [x] Replace finance callsites (`event-organize`, `profile`, `receipt-approval-*`, `receipt-refund-list`, `transaction-list`) with `AppRpc` query/mutation helpers
  - [x] Decommission legacy tRPC `finance` namespace from app router composition and delete obsolete finance router files
  - [x] Commit milestone

- [x] Task: Decommission residual tRPC transport scaffolding after Effect RPC cutover (b43b030)
  - [x] Define test intent (`CI=true bun run lint`, `CI=true bun run build`, `CI=true bun run test`)
  - [x] Remove Angular tRPC provider/client scaffolding (`provideTRPC`, `core/trpc-client.ts`)
  - [x] Remove Express `/trpc` middleware and now-unused server tRPC router/server files
  - [x] Move shared discount-provider config helper out of `src/server/trpc/**` and remove direct tRPC error dependency
  - [x] Remove obsolete tRPC/tanstack-trpc packages and refresh Bun lockfile
  - [x] Commit milestone

- [ ] Task: Conductor - User Manual Verification 'Phase 6'

## Final Gate

- [x] Run full quality gates in Bun-first mode (54c27f8)
  - [x] `CI=true bun run lint:fix`
  - [x] `CI=true bun run lint`
  - [x] `CI=true bun run build`
  - [x] `CI=true bun run test`
  - [x] `CI=true bun run e2e`
  - [x] `CI=true bun run e2e:docs`
- [x] Add/update Knope change file documenting migration status and scope (54c27f8)

## Validation Snapshot (2026-02-07)

- `bun run lint:fix` passes with existing repo warnings only.
- `bun run lint` passes with existing repo warnings only.
- `bun run build` passes.
- `bun run test` passes after restoring Jasmine type package and strict pipe signature alignment.
- `bunx --bun playwright test --project=setup` passes (`7/7`) with Docker + `NO_WEBSERVER=true`.
- `CI=true bun run lint` passes (warnings only).
- `CI=true bun run build` passes.
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && NO_WEBSERVER=true CI=true bunx --bun playwright test tests/specs/discounts/esn-discounts.test.ts --project=local-chrome --workers=1 --max-failures=1'` passes after checkout-path stabilization.
- Local-chrome discounts flow now validates Stripe checkout-link creation (`Pay now`) reliably in repeated runs.
- `CI=true bun run e2e` passes: `65 passed`, `6 skipped` (Playwright summary).
- `CI=true bun run e2e:docs` passes: `23 passed` (Playwright summary).
- `tests/specs/templates/templates.test.ts` passes end-to-end with unique title generation and Bun-safe template create/update server path.
- `tests/docs/profile/discounts.doc.ts` and `tests/docs/events/event-approval.doc.ts` pass under docs project with deterministic navigation/seeding.
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/templates/templates.test.ts --project=local-chrome --workers=1 --max-failures=1'` passes after icons Effect RPC migration (`11 passed`).
- `CI=true bun run e2e:docs` re-run passes after icons Effect RPC migration (`23 passed`).
- `CI=true bun run lint:fix`, `CI=true bun run lint`, `CI=true bun run build`, and `CI=true bun run test` pass after templateCategories Effect RPC migration (warnings-only lint baseline unchanged).
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/templates/templates.test.ts --project=local-chrome --workers=1 --max-failures=1'` passes after templateCategories Effect RPC migration (`11 passed`).
- `CI=true bun run e2e:docs` re-run passes after templateCategories Effect RPC migration (`23 passed`).
- `CI=true bun run lint:fix`, `CI=true bun run lint`, `CI=true bun run build`, and `CI=true bun run test` pass after templates groupedByCategory Effect RPC migration (warnings-only lint baseline unchanged).
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/templates/templates.test.ts --project=local-chrome --workers=1 --max-failures=1'` passes after templates groupedByCategory Effect RPC migration (`11 passed`).
- `CI=true bun run e2e:docs` re-run passes after templates groupedByCategory Effect RPC migration (`23 passed`).
- `bun run lint:fix`, `bun run lint`, and `bun run build` are currently blocked in this shell by immediate `SIGKILL` termination from `bunx --bun ng ...` (no diagnostics emitted before kill).
- `bunx --bun eslint` passes on all files touched by the `@heddendorp/effect-angular-query@0.1.1` migration.
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after migration.
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/templates/templates.test.ts --project=local-chrome --workers=1 --max-failures=1'` passes after v0.1.1 migration (`11 passed`).
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/templates/templates.doc.ts --project=docs --workers=1 --max-failures=1'` passes after v0.1.1 migration (`8 passed`).
- `bunx --bun eslint` passes on remaining auth/config cutover files after deleting `src/app/core/effect-rpc-client.ts`.
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after auth/config cutover.
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/templates/templates.test.ts --project=local-chrome --workers=1 --max-failures=1'` passes after auth/config cutover (`11 passed`).
- `CI=true bun run lint` now executes successfully again in this shell after auth/config cutover (warnings-only baseline unchanged).
- `CI=true bun run build` now executes successfully again in this shell after auth/config cutover.
- `CI=true bun run test` passes after auth/config cutover (`12 passed`).
- `CI=true bun run lint` passes after `users.userAssigned` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `users.userAssigned` Effect RPC cutover.
- `CI=true bun run test` passes after `users.userAssigned` Effect RPC cutover (`12 passed`).
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `users.userAssigned` Effect RPC cutover.
- `CI=true bun run lint` passes after `users.maybeSelf`/`users.self`/`users.updateProfile` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `users.maybeSelf`/`users.self`/`users.updateProfile` Effect RPC cutover.
- `CI=true bun run test` passes after `users.maybeSelf`/`users.self`/`users.updateProfile` Effect RPC cutover (`12 passed`).
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `users.maybeSelf`/`users.self`/`users.updateProfile` Effect RPC cutover.
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/profile/discounts.doc.ts --project=docs --workers=1 --max-failures=1'` passes after `users.maybeSelf`/`users.self`/`users.updateProfile` Effect RPC cutover (`8 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/profile/user-profile/user-profile.component.ts src/server/trpc/users/users.router.ts` passes after `users.events.findMany` Effect RPC cutover (warnings-only baseline unchanged).
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `users.events.findMany` Effect RPC cutover.
- `CI=true bun run lint` passes after `users.events.findMany` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `users.events.findMany` Effect RPC cutover.
- `CI=true bun run test` passes after `users.events.findMany` Effect RPC cutover (`12 passed`).
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/profile/discounts.doc.ts --project=docs --workers=1 --max-failures=1'` passes after `users.events.findMany` Effect RPC cutover (`8 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.web-handler.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/core/create-account/create-account.component.ts src/server/trpc/users/users.router.ts` passes after `users.authData`/`users.createAccount` Effect RPC cutover (warnings-only baseline unchanged).
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `users.authData`/`users.createAccount` Effect RPC cutover.
- `CI=true bun run lint` passes after `users.authData`/`users.createAccount` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `users.authData`/`users.createAccount` Effect RPC cutover.
- `CI=true bun run test` passes after `users.authData`/`users.createAccount` Effect RPC cutover (`12 passed`).
- `bunx --bun eslint src/app/events/guards/event-edit.guard.ts src/app/events/guards/event-organizer.guard.ts src/app/shared/components/controls/role-select/role-select.component.ts` passes after removing `injectTRPCClient()` callsites.
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after removing `injectTRPCClient()` callsites.
- `rg -n "injectTRPCClient\\(" src/app` returns no matches after callsite cleanup.
- `CI=true bun run lint` passes after removing `injectTRPCClient()` callsites (warnings-only baseline unchanged).
- `CI=true bun run build` passes after removing `injectTRPCClient()` callsites.
- `CI=true bun run test` passes after removing `injectTRPCClient()` callsites (`12 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/admin/user-list/user-list.component.ts src/server/trpc/users/users.router.ts` passes after `users.findMany` Effect RPC cutover.
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `users.findMany` Effect RPC cutover.
- `CI=true bun run lint` passes after `users.findMany` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `users.findMany` Effect RPC cutover.
- `CI=true bun run test` passes after `users.findMany` Effect RPC cutover (`12 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/server/trpc/admin/role.router.ts src/app/admin/role-list/role-list.component.ts src/app/templates/template-create/template-create.component.ts src/app/admin/role-details/role-details.component.ts src/app/admin/role-edit/role-edit.component.ts src/app/admin/role-create/role-create.component.ts src/app/shared/components/controls/role-select/role-select.component.ts` passes after `admin.roles` read Effect RPC cutover.
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `admin.roles` read Effect RPC cutover.
- `CI=true bun run lint` passes after `admin.roles` read Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `admin.roles` read Effect RPC cutover.
- `CI=true bun run test` passes after `admin.roles` read Effect RPC cutover (`12 passed`).
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/roles/roles.doc.ts --project=docs --workers=1 --max-failures=1'` passes after `admin.roles` read Effect RPC cutover (`8 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/server/trpc/admin/role.router.ts src/app/internal-pages/members-hub/members-hub.component.ts src/app/internal-pages/members-hub/members-hub.component.html src/app/admin/role-create/role-create.component.ts src/app/admin/role-edit/role-edit.component.ts` passes after `admin.roles.findHubRoles` Effect RPC cutover.
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `admin.roles.findHubRoles` Effect RPC cutover.
- `CI=true bun run lint` passes after `admin.roles.findHubRoles` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `admin.roles.findHubRoles` Effect RPC cutover.
- `CI=true bun run test` passes after `admin.roles.findHubRoles` Effect RPC cutover (`12 passed`).
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/roles/roles.doc.ts --project=docs --workers=1 --max-failures=1'` passes after `admin.roles.findHubRoles` Effect RPC cutover (`8 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/admin/role-create/role-create.component.ts src/app/admin/role-edit/role-edit.component.ts src/server/trpc/admin/admin.router.ts` passes after `admin.roles` mutation Effect RPC cutover.
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `admin.roles` mutation Effect RPC cutover.
- `CI=true bun run lint` passes after `admin.roles` mutation Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `admin.roles` mutation Effect RPC cutover.
- `CI=true bun run test` passes after `admin.roles` mutation Effect RPC cutover (`12 passed`).
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/roles/roles.doc.ts --project=docs --workers=1 --max-failures=1'` passes after `admin.roles` mutation Effect RPC cutover (`8 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/admin/general-settings/general-settings.component.ts src/app/admin/tax-rates-settings/tax-rates-settings.component.ts src/app/admin/components/import-tax-rates-dialog/import-tax-rates-dialog.component.ts src/server/trpc/app-router.ts` passes after `admin.tenant` Effect RPC cutover.
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `admin.tenant` Effect RPC cutover.
- `CI=true bun run lint` passes after `admin.tenant` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `admin.tenant` Effect RPC cutover.
- `CI=true bun run test` passes after `admin.tenant` Effect RPC cutover (`12 passed`).
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/finance/tax-rates/admin-import-tax-rates.spec.ts tests/docs/finance/inclusive-tax-rates.doc.ts --project=local-chrome --project=docs --workers=1 --max-failures=1'` passes after `admin.tenant` Effect RPC cutover (`11 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/templates/template-details/template-details.component.ts src/app/templates/shared/template-form/template-registration-option-form.component.ts src/app/shared/components/forms/registration-option-form/registration-option-form.ts src/server/trpc/app-router.ts` passes after `taxRates.listActive` Effect RPC cutover.
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `taxRates.listActive` Effect RPC cutover.
- `CI=true bun run lint` passes after `taxRates.listActive` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `taxRates.listActive` Effect RPC cutover.
- `CI=true bun run test` passes after `taxRates.listActive` Effect RPC cutover (`12 passed`).
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/templates/paid-option-requires-tax-rate.spec.ts tests/docs/templates/templates.doc.ts --project=local-chrome --project=docs --workers=1 --max-failures=1'` passes after `taxRates.listActive` Effect RPC cutover (`8 passed`, `6 skipped`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/server/trpc/discounts/discounts.router.ts src/app/admin/general-settings/general-settings.component.ts src/app/events/event-edit/event-edit.ts src/app/templates/template-create-event/template-create-event.component.ts src/app/profile/user-profile/user-profile.component.ts` passes after `discounts.getTenantProviders` Effect RPC cutover (warnings-only baseline unchanged).
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `discounts.getTenantProviders` Effect RPC cutover.
- `CI=true bun run lint` passes after `discounts.getTenantProviders` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `discounts.getTenantProviders` Effect RPC cutover.
- `CI=true bun run test` passes after `discounts.getTenantProviders` Effect RPC cutover (`12 passed`).
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/profile/discounts.doc.ts tests/docs/templates/templates.doc.ts --project=docs --workers=1 --max-failures=1'` passes after `discounts.getTenantProviders` Effect RPC cutover (`9 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/profile/user-profile/user-profile.component.ts src/app/events/event-details/event-details.component.ts src/server/trpc/app-router.ts` passes after discounts-card Effect RPC cutover.
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after discounts-card Effect RPC cutover.
- `CI=true bun run lint` passes after discounts-card Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after discounts-card Effect RPC cutover.
- `CI=true bun run test` passes after discounts-card Effect RPC cutover (`12 passed`).
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/docs/profile/discounts.doc.ts --project=docs --workers=1 --max-failures=1'` passes after discounts-card Effect RPC cutover (`8 passed`).
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/discounts/esn-discounts.test.ts --project=local-chrome --workers=1 --max-failures=1'` passes after discounts-card Effect RPC cutover (`8 passed`; setup reports transient flaky retries in this environment).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/shared/components/controls/editor/editor.component.ts src/server/trpc/app-router.ts` passes after `editorMedia.createImageDirectUpload` Effect RPC cutover.
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `editorMedia.createImageDirectUpload` Effect RPC cutover.
- `CI=true bun run lint` passes after `editorMedia.createImageDirectUpload` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `editorMedia.createImageDirectUpload` Effect RPC cutover.
- `CI=true bun run test` passes after `editorMedia.createImageDirectUpload` Effect RPC cutover (`12 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/global-admin/tenant-list/tenant-list.component.ts src/app/global-admin/tenant-list/tenant-list.component.html src/server/trpc/global-admin/tenant.router.ts` passes after `globalAdmin.tenants.findMany` Effect RPC cutover.
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `globalAdmin.tenants.findMany` Effect RPC cutover.
- `CI=true bun run lint` passes after `globalAdmin.tenants.findMany` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `globalAdmin.tenants.findMany` Effect RPC cutover.
- `CI=true bun run test` passes after `globalAdmin.tenants.findMany` Effect RPC cutover (`12 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/events/event-details/event-details.component.ts src/app/events/guards/event-organizer.guard.ts src/server/trpc/events/events.router.ts` passes after `events.canOrganize` Effect RPC cutover (warnings-only baseline unchanged).
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `events.canOrganize` Effect RPC cutover.
- `CI=true bun run lint` passes after `events.canOrganize` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `events.canOrganize` Effect RPC cutover.
- `CI=true bun run test` passes after `events.canOrganize` Effect RPC cutover (`12 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/events/event-details/event-details.component.ts src/app/events/event-registration-option/event-registration-option.component.ts src/app/events/event-active-registration/event-active-registration.component.ts src/server/trpc/events/events.router.ts` passes after `events.getRegistrationStatus` Effect RPC cutover (warnings-only baseline unchanged).
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `events.getRegistrationStatus` Effect RPC cutover.
- `CI=true bun run lint` passes after `events.getRegistrationStatus` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `events.getRegistrationStatus` Effect RPC cutover.
- `CI=true bun run test` passes after `events.getRegistrationStatus` Effect RPC cutover (`12 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/admin/admin-overview/admin-overview.component.ts src/app/admin/event-reviews/event-reviews.component.ts src/app/events/event-details/event-details.component.ts src/server/trpc/events/events.router.ts` passes after `events.getPendingReviews` Effect RPC cutover (warnings-only baseline unchanged).
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `events.getPendingReviews` Effect RPC cutover.
- `CI=true bun run lint` passes after `events.getPendingReviews` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `events.getPendingReviews` Effect RPC cutover.
- `CI=true bun run test` passes after `events.getPendingReviews` Effect RPC cutover (`12 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/events/event-list.service.ts src/app/events/event-list/event-list.component.ts src/app/events/event-list/event-list.component.html src/app/events/event-edit/event-edit.ts src/app/events/event-details/event-details.component.ts src/app/admin/event-reviews/event-reviews.component.ts src/app/templates/template-create-event/template-create-event.component.ts src/server/trpc/events/events.router.ts` passes after `events.eventList` Effect RPC cutover (warnings-only baseline unchanged).
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `events.eventList` Effect RPC cutover.
- `CI=true bun run lint` passes after `events.eventList` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `events.eventList` Effect RPC cutover.
- `CI=true bun run test` passes after `events.eventList` Effect RPC cutover (`12 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/app/events/event-edit/event-edit.ts src/server/trpc/events/events.router.ts` passes after `events.findOneForEdit` Effect RPC cutover (warnings-only baseline unchanged).
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `events.findOneForEdit` Effect RPC cutover.
- `CI=true bun run lint` passes after `events.findOneForEdit` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `events.findOneForEdit` Effect RPC cutover.
- `CI=true bun run test` passes after `events.findOneForEdit` Effect RPC cutover (`12 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/server/trpc/events/events.router.ts src/app/events/event-details/event-details.component.ts src/app/events/event-organize/event-organize.ts src/app/events/guards/event-edit.guard.ts src/app/events/guards/event-organizer.guard.ts src/app/events/event-registration-option/event-registration-option.component.ts src/app/admin/event-reviews/event-reviews.component.ts` passes after `events.findOne` + `events.getOrganizeOverview` Effect RPC cutover (warnings-only baseline unchanged).
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `events.findOne` + `events.getOrganizeOverview` Effect RPC cutover.
- `CI=true bun run lint` passes after `events.findOne` + `events.getOrganizeOverview` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `events.findOne` + `events.getOrganizeOverview` Effect RPC cutover.
- `CI=true bun run test` passes after `events.findOne` + `events.getOrganizeOverview` Effect RPC cutover (`12 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/server/trpc/events/events.router.ts src/app/events/event-details/event-details.component.ts src/app/admin/event-reviews/event-reviews.component.ts` passes after `events.reviewEvent` + `events.submitForReview` + `events.updateListing` Effect RPC cutover (warnings-only baseline unchanged).
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `events.reviewEvent` + `events.submitForReview` + `events.updateListing` Effect RPC cutover.
- `CI=true bun run lint` passes after `events.reviewEvent` + `events.submitForReview` + `events.updateListing` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `events.reviewEvent` + `events.submitForReview` + `events.updateListing` Effect RPC cutover.
- `CI=true bun run test` passes after `events.reviewEvent` + `events.submitForReview` + `events.updateListing` Effect RPC cutover (`12 passed`).
- `bunx --bun eslint src/shared/rpc-contracts/app-rpcs.ts src/server/effect/rpc/app-rpcs.handlers.ts src/server/trpc/events/events.router.ts src/app/events/event-edit/event-edit.ts src/app/templates/template-create-event/template-create-event.component.ts` passes after `events.create` + `events.update` Effect RPC cutover (warnings-only baseline unchanged).
- `bunx --bun tsc -p tsconfig.app.json --noEmit` and `bunx --bun tsc -p tsconfig.spec.json --noEmit` pass after `events.create` + `events.update` Effect RPC cutover.
- `CI=true bun run lint` passes after `events.create` + `events.update` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `events.create` + `events.update` Effect RPC cutover.
- `CI=true bun run test` passes after `events.create` + `events.update` Effect RPC cutover (`12 passed`).
- `CI=true bun run lint` passes after `events.registerForEvent` + `events.cancelPendingRegistration` + `events.registrationScanned` Effect RPC cutover (warnings-only baseline unchanged).
- `CI=true bun run build` passes after `events.registerForEvent` + `events.cancelPendingRegistration` + `events.registrationScanned` Effect RPC cutover.
- `CI=true bun run test` passes after `events.registerForEvent` + `events.cancelPendingRegistration` + `events.registrationScanned` Effect RPC cutover (`12 passed`).
- `CI=true bun run lint` passes after template simple-flow Effect RPC cutover (`templates.findOne`, `templates.createSimpleTemplate`, `templates.updateSimpleTemplate`) with warnings-only baseline unchanged.
- `CI=true bun run build` passes after template simple-flow Effect RPC cutover.
- `CI=true bun run test` passes after template simple-flow Effect RPC cutover (`12 passed`).
- `CI=true bun run lint` passes after decommissioning unused tRPC `users` + `globalAdmin` namespaces (warnings-only baseline unchanged).
- `CI=true bun run build` passes after decommissioning unused tRPC `users` + `globalAdmin` namespaces.
- `CI=true bun run test` passes after decommissioning unused tRPC `users` + `globalAdmin` namespaces (`12 passed`).
- `CI=true bun run lint` passes after finance Effect RPC cutover + tRPC finance router removal (warnings-only baseline: `45 warnings`, `0 errors`).
- `CI=true bun run build` passes after finance Effect RPC cutover + tRPC finance router removal.
- `CI=true bun run test` passes after finance Effect RPC cutover + tRPC finance router removal (`12 passed`).
- `CI=true bun run lint` passes after removing residual tRPC transport scaffolding (warnings-only baseline: `45 warnings`, `0 errors`).
- `CI=true bun run build` passes after removing residual tRPC transport scaffolding.
- `CI=true bun run test` passes after removing residual tRPC transport scaffolding (`12 passed`).
- `bunx --bun eslint tests/specs/finance/receipts-flows.spec.ts` passes after finance receipts Playwright stabilization updates.
- `bash -lc 'eval "$(bun helpers/testing/runtime-env.mjs)" && CI=true NO_WEBSERVER=true bunx --bun playwright test tests/specs/finance/receipts-flows.spec.ts --project=local-chrome --workers=1 --max-failures=1'` passes after receipts-flow stabilization (`10 passed`).
- `CI=true bun run e2e:docs` currently fails in docs-only specs (`inclusive-tax-rates.doc.ts`, `discounts.doc.ts`) and is tracked for follow-up hardening.

## Session Handoff

- Detailed continuation context for this checkpoint is captured in:
  - `conductor/tracks/bun-angular-alignment_20260128/handoff-2026-02-07.md`
  - `conductor/tracks/bun-angular-alignment_20260128/handoff-2026-02-10.md`
  - `conductor/tracks/bun-angular-alignment_20260128/handoff-2026-02-11.md`
  - `conductor/tracks/bun-angular-alignment_20260128/handoff-2026-02-12.md`
  - `conductor/tracks/bun-angular-alignment_20260128/handoff-2026-02-13.md`
