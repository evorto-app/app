# Changelog

All notable changes to this project will be documented in this file.
## 0.0.1 (2026-03-15)

### Features

- isolate worktree runtime and use neon local db
- centralize env validation and align CI secrets
- implement the discount track (#38)

#### Migrate forms to Angular Signal Forms

Migrate form models, templates, and custom form controls from legacy reactive
forms/CVA patterns to Angular Signal Forms.

Highlights:

- migrate form bindings to `form()` + `[formField]` patterns,
- move reusable form logic into signal-form schemas and defaults,
- update reusable child form composition and hidden-field behavior,
- fix migration regressions (date handling, dependent permissions, role
  autocomplete de-duplication, location search input behavior),
- update docs/e2e coverage for key signal-forms flows.

### Fixes

- enable tax-rate tests and align permissions (#36)
- seed scope and event creation

#### Stabilize Bun local runtime around Neon and Effect RPC SSR transport

Improve local Bun runtime reliability for migration and CI parity by:

- preferring Neon local fetch transport paths (no websocket handoff) in app and Playwright DB clients,
- removing transaction-only registration seeding writes that forced websocket fallback under Neon local,
- aligning runtime test defaults to deterministic local ports for auth callback consistency,
- resolving server-side Effect RPC requests through an absolute `/rpc` origin during SSR.

#### Stabilize Bun template flows and docs e2e reliability

Finalize Bun-first migration quality gates by:

- removing transaction-only template simple create/update writes that failed on Neon local websocket transaction paths under Bun,
- persisting template `location` consistently across create and update inputs in the simple template router,
- tightening docs test selectors/navigation for profile discounts and event approval workflows,
- reducing template e2e data collisions by generating unique template titles per run,
- validating final Bun gates end-to-end (`lint`, `build`, `test`, `e2e`, and `e2e:docs`).

#### Improve local E2E test ergonomics and deterministic config loading:

- Automatically load `.env.development` whenever the file exists (no `LOAD_ENV_DEVELOPMENT=true` flag required).
- Remove `LOAD_ENV_DEVELOPMENT=true` from Playwright npm scripts.
- Default `NO_WEBSERVER` to `false` in Playwright environment validation when it is unset.

#### Move icon selector APIs from tRPC to Effect RPC

Continue the tRPC decommission by migrating the icon domain to Effect RPC:

- add shared `icons.search` and `icons.add` Effect RPC contracts,
- implement authenticated icon handlers in the Effect RPC server layer,
- migrate icon selector client calls and query invalidation to Effect RPC helpers/client,
- remove `icons` from the tRPC app router surface and delete the unused tRPC icons router.

#### Move template category APIs from tRPC to Effect RPC

Continue the tRPC decommission by migrating the template category domain to Effect RPC:

- add shared `templateCategories.findMany`, `templateCategories.create`, and `templateCategories.update` Effect RPC contracts,
- implement authenticated/permissioned template category handlers in the Effect RPC server layer,
- migrate template category query/mutation callsites to Effect RPC helpers/client,
- remove `templateCategories` from the tRPC app router surface and delete the obsolete tRPC template category router.

#### Move templates grouped-by-category reads from tRPC to Effect RPC

Continue the template-domain cutover by migrating grouped template-list reads to Effect RPC:

- add shared `templates.groupedByCategory` Effect RPC contract and typed response schema,
- implement tenant-scoped grouped template read handler in the Effect RPC server layer,
- migrate template list and category list query callsites to Effect RPC helpers,
- update create/edit invalidations to target Effect RPC query keys for grouped templates,
- remove `templates.groupedByCategory` from the tRPC template router.

#### Polish finance receipts submission, approval, and refund flows

Update the finance receipts experience with:

- tenant-level finance settings for allowed receipt countries plus an `Allow other` toggle,
- shared receipt form fields between submit and approval flows (date picker, tax amount, country select, checkbox-driven amount fields),
- refund list stability fixes to prevent signal writes during template rendering and keep the Material table flow reliable,
- removal of the finance overview shortcut to profile receipts,
- updated Playwright specs and docs coverage for the receipts workflows.

#### Tighten Neon Local CI wiring and TLS guardrails

Follow up on Neon Local runtime review feedback by:

- forwarding Neon branch-related environment variables into the Docker `db` service for CI runs,
- removing the unnecessary CI hard-fail on `PARENT_BRANCH_ID` because Neon defaults to the project's default branch when it is unset,
- restoring `@db/*` imports in Playwright fixtures,
- limiting the Neon Local TLS certificate bypass to local proxy hostnames only.

#### Align Playwright tests with new structure and linting

- migrate Playwright tests to `tests/**` (docs in `tests/docs/**`) and retire legacy `e2e/` layout,
- enforce required `@track`, `@req`, and `@doc` tags via ESLint for Playwright tests,
- update documentation, configs, and tooling references to the new test structure,
- temporarily skip unstable e2e/doc tests discovered during the migration.

#### Require change files for release notes

Document the team policy to always use Knope change files in `.changeset/*.md`
for release documentation, instead of relying on conventional commits or PR
titles.

#### Align tax rates track behavior with specification

Align tax rate permissions, sync behavior, and registration persistence with the tax-rates conductor track.

Highlights:

- switch tax-rate admin access checks from `admin:manageTaxes` to `admin:tax` (with legacy compatibility mapping for existing roles),
- enforce server-side rejection of non-inclusive Stripe tax rates during import,
- persist selected registration tax-rate snapshot fields (`tax_rate_id`, name, percentage, inclusive/exclusive) on `event_registrations`,
- require tax-rate selection only when registration options are paid.

#### Migrate rich text editor from TinyMCE to Tiptap core (MIT-only)

- replace TinyMCE integration with a Tiptap core editor implementation in shared form controls,
- add Cloudflare Images direct-upload support for drag/drop, paste, and file-picker image insertion,
- add server-side rich text sanitization for template and event descriptions,
- enforce an MIT-only guard for Tiptap dependencies and block Tiptap Platform/Pro references.
