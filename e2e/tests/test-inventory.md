# E2E Test Inventory

Scope: Playwright coverage split between documentation journeys (`docs/**`) and regression/contract specs (`specs/**`).

## Documentation journeys (`*.doc.ts`)

- `docs/discounts/discounts.doc.ts` — Admin configures ESN provider and a member registers a card.
- `docs/events/event-management.doc.ts` — Create and manage events end to end.
- `docs/events/esncard-pricing.doc.ts` — Configure ESNcard discount pricing in event editor.
- `docs/events/register.doc.ts` — Register for free and paid events.
- `docs/events/unlisted-admin.doc.ts` — Admin perspective on unlisted events.
- `docs/events/unlisted-user.doc.ts` — Member understanding of unlisted events.
- `docs/finance/finance-overview.doc.ts` — Finance dashboard management (`@finance`).
- `docs/finance/inclusive-tax-rates.doc.ts` — Import and apply inclusive tax rates.
- `docs/profile/discounts.doc.ts` — Manage ESN discount card from profile (`@finance`).
- `docs/scanning/esncard-scan.doc.ts` — Scan flow shows ESNcard discount marker.
- `docs/profile/user-profile.doc.ts` — Manage personal profile settings.
- `docs/roles/roles.doc.ts` — Create and configure custom roles.
- `docs/template-categories/categories.doc.ts` — Maintain template categories.
- `docs/templates/templates.doc.ts` — Manage event templates.
- `docs/users/create-account.doc.ts` — Self-service account creation (`@needs-auth0`).

## Functional suites (`*.test.ts` / `*.spec.ts`)

### Auth & storage

- `specs/auth/storage-state-refresh.test.ts` — Storage state freshness: enforces age and tenant cookie validity.

### Contracts

- `specs/contracts/discounts/discounts.cards.crud.spec.ts` — ESNcard CRUD contract (CTA visibility, validation, enable/disable).
- `specs/contracts/discounts/discounts.catalog.spec.ts` — Tenant discount provider settings persist across reloads.
- `specs/contracts/discounts/discounts.setTenantProviders.spec.ts` — Tenant provider toggles propagate to user profile.
- `specs/contracts/events/events.pricing.selection.spec.ts` — ESN discount pricing path and expired card fallback (`@slow`).
- `specs/contracts/templates/templates.discounts.duplication.spec.ts` — Template → event duplication preserves discount configuration (`test.fixme`).

### Events

- `specs/events/create-event-from-template.test.ts` — Creates event from template.
- `specs/events/esncard-discounts.spec.ts` — ESNcard pricing eligibility (valid vs expired card).
- `specs/events/free-event-registration.test.ts` — Registers for an available free event.
- `specs/events/price-labels-inclusive.spec.ts` — Inclusive price label coverage across events and templates (`@events @taxRates @priceLabels`).
- `specs/events/unlisted-visibility-matrix.test.ts` — Visibility matrix for unlisted events (member vs admin).

### Finance & taxation

- `specs/finance/discounts/esn-discounts.test.ts` — Applies ESN discount during paid registration (`@finance`).
- `specs/finance/checkout/checkout-uses-tax-rate-id.spec.ts` — Checkout integrations respect displayed prices and tax metadata (`@finance @taxRates @checkout`).
- `specs/finance/tax-rates/admin-import-tax-rates.spec.ts` — Admin tax-rate import, permissions, and isolation (`@finance @taxRates`).

### Permissions

- `specs/permissions/internal-link-override.test.ts` — Internal link appears after granting `internal:viewInternalPages`.
- `specs/permissions/tenant-isolation-tax-rates.spec.ts` — Tenant isolation for tax rates across UI and API layers.

### Templates & categories

- `specs/template-categories/manage-template-categories.test.ts` — Creates and edits template categories.
- `specs/templates/template-crud-flows.test.ts` — Template CRUD flows (create/view).
- `specs/templates/paid-option-requires-tax-rate.spec.ts` — Paid template options require compatible tax rates (`@templates @taxRates`).

### Scanning

- `specs/scanning/qr-check-in-flow.test.ts` — Confirmed registration scan permits check-in.

### Smoke & seed guards

- `specs/smoke/load-application-shell.test.ts` — Loads the shell and navigates to events list.
- `specs/seed/seed-baseline-invariants.test.ts` — Soft assertions for seeded tenant/categories/events mixture.

### Tooling & infrastructure

- `specs/tooling/doc-screenshot-helper.test.ts` — Doc screenshot helper returns relative paths and writes images.
- `specs/tooling/documentation-reporter-paths.test.ts` — Documentation reporter honors env overrides and normalizes permissions callouts.

## Notes

- Use `yarn e2e` for regression suites and `yarn e2e:docs` for documentation generation.
- Keep new tests aligned with the folder conventions above (see `e2e/AGENTS.md` for authoring rules).
