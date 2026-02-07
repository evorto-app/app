# Changelog

All notable changes to this project will be documented in this file.
## 0.0.1 (2026-02-07)

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

#### Polish finance receipts submission, approval, and refund flows

Update the finance receipts experience with:

- tenant-level finance settings for allowed receipt countries plus an `Allow other` toggle,
- shared receipt form fields between submit and approval flows (date picker, tax amount, country select, checkbox-driven amount fields),
- refund list stability fixes to prevent signal writes during template rendering and keep the Material table flow reliable,
- removal of the finance overview shortcut to profile receipts,
- updated Playwright specs and docs coverage for the receipts workflows.

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
