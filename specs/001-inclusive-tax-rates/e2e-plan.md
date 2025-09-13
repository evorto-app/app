// filepath: /Users/hedde/code/evorto/specs/001-inclusive-tax-rates/e2e-plan.md

# E2E Test Plan: Inclusive Tax Rates

Purpose: Ensure every acceptance scenario, edge case, and functional requirement in this feature is covered by Playwright end-to-end tests using the repository's existing patterns and helpers.

Scope: Tests span admin import flows, creator validation, participant price display, checkout integration, permissions, tenant isolation, logging, and edge cases (discounts, 0%, unavailable rates).

Project context reference:

- E2E root: e2e/tests/
- Existing categories: auth/, discounts/, events/, finance/, permissions/, templates/, template-categories/
- Helpers: helpers/create-tenant.ts, helpers/add-tax-rates.ts, helpers/add-templates.ts, helpers/add-events.ts, helpers/add-registrations.ts, helpers/add-roles.ts

Test data & environment setup:

- Tenants: create two tenants (Tenant A, Tenant B) for isolation checks.
- Sample rates per tenant: inclusive active 0%, 7%, 19% (seed via helpers/add-tax-rates.ts or admin import flow where needed).
- Roles/permissions: ensure admin role with admin:manageTaxes; creators with standard content permissions; regular user for participant flows.
- Stripe: prefer live test mode. If credentials absent in CI, intercept boundary tRPC calls and assert payloads (including tax rate ID and final price). Keep tests deterministic.
- Cleanup: tests create per-run tenants with unique suffix; teardown removes created entities if needed.

File structure and planned specs (proposed; align with existing folder conventions):

- e2e/tests/finance/tax-rates/admin-import-tax-rates.spec.ts
  - Covers: FR-001, FR-002, FR-004, FR-006, FR-007, FR-016 (verify sample), FR-024 (permission gate)
  - Steps:
    - As admin with admin:manageTaxes, open Import dialog; list provider rates (inclusive/active vs incompatible disabled).
    - Import one or more inclusive active rates.
    - Verify "Imported tax rates" list shows name, percent, status; incompatible not selectable.
    - Negative: without admin:manageTaxes, route/action blocked.
- e2e/tests/templates/paid-option-requires-tax-rate.spec.ts
  - Covers: FR-008, FR-009, FR-010, FR-018
  - Steps:
    - With at least one imported compatible rate, create/edit template with paid option; verify tax rate is required and must be compatible; free option disables field and clears value.
    - When no compatible rates imported, saving paid option is blocked with guidance.
    - Bulk/clone attempt cannot apply incompatible rate (server validation wins).
- e2e/tests/events/price-labels-inclusive.spec.ts
  - Covers: FR-011, FR-017, FR-022
  - Steps:
    - Event details and listing show price with label "Incl. <percentage>% <name>".
    - 0% rate shows "Incl. 0% Tax".
    - If label details cannot be resolved, show fallback "Incl. Tax".
- e2e/tests/finance/checkout-uses-tax-rate-id.spec.ts
  - Covers: FR-012, FR-015, FR-013 (happy path attach), FR-021 (warn on inactive)
  - Steps:
    - Register for paid option; assert payment request uses displayed tax-inclusive price and includes tax rate identifier; ensure persisted association post-payment.
    - If imported rate flagged inactive on server, warn log but proceed (Stripe test mode should still accept if rate exists).
- e2e/tests/finance/fallback-unavailable-rate.spec.ts
  - Covers: FR-013, FR-017, FR-021
  - Steps:
    - Simulate previously saved option with now-unavailable rate (e.g., remove from imported table or simulate provider archival).
    - Verify checkout remains functional where possible and UI label falls back to "Incl. Tax"; if provider rejects, surface error gracefully.
- e2e/tests/discounts/discount-reduces-inclusive-price.spec.ts
  - Covers: FR-014 + Edge: discount to zero → treat as free
  - Steps:
    - Apply discount to paid option; amount reduced, inclusive label unchanged.
    - Apply larger discount such that price <= 0; option treated as free and no tax rate at checkout.
- e2e/tests/permissions/admin-manage-taxes-permission.spec.ts
  - Covers: FR-024
  - Steps:
    - Users without admin:manageTaxes cannot access import/list actions; users with it can.
- e2e/tests/permissions/tenant-isolation-tax-rates.spec.ts
  - Covers: FR-003, FR-019
  - Steps:
    - Tenant A imports rates; ensure Tenant B cannot see/use A's rates when creating paid options; verify isolation in APIs and UI.
- e2e/tests/finance/zero-percent-inclusive-rate.spec.ts
  - Covers: FR-022 (redundant check separate from labels file to keep edge explicit)
  - Steps:
    - Create paid option using 0% rate; verify label format and checkout payload.
- e2e/tests/finance/audit-logging-import-and-unavailability.spec.ts
  - Covers: FR-023, FR-021
  - Steps:
    - Import rates; assert audit/log entries exist for import.
    - Make an in-use rate unavailable; assert unavailability logging and a tenant-level warning list UI area if present.

Acceptance scenarios mapping (from spec):

- S1: Admin imports inclusive active rate → admin-import-tax-rates.spec.ts
- S2: Free option disables tax field → paid-option-requires-tax-rate.spec.ts
- S3: Paid prices display inclusive label → price-labels-inclusive.spec.ts
- S4: Discounted price keeps label, reduces amount → discount-reduces-inclusive-price.spec.ts
- S5: Unavailable rate fallback label → fallback-unavailable-rate.spec.ts
- S6: No compatible rates → block save with guidance → paid-option-requires-tax-rate.spec.ts
- S7: Multi-tenant isolation → tenant-isolation-tax-rates.spec.ts
- S8: Checkout passes rate id and uses final price → checkout-uses-tax-rate-id.spec.ts

Functional requirements coverage matrix (concise):

- FR-001..FR-007, FR-016, FR-024 → admin-import-tax-rates.spec.ts (+ permissions spec)
- FR-008..FR-010, FR-018 → paid-option-requires-tax-rate.spec.ts
- FR-011, FR-017, FR-022 → price-labels-inclusive.spec.ts (+ zero-percent-inclusive-rate.spec.ts)
- FR-012, FR-015 → checkout-uses-tax-rate-id.spec.ts
- FR-013, FR-017, FR-021 → fallback-unavailable-rate.spec.ts (+ audit-logging-import-and-unavailability.spec.ts)
- FR-014 → discount-reduces-inclusive-price.spec.ts
- FR-019 → tenant-isolation-tax-rates.spec.ts
- FR-023 → audit-logging-import-and-unavailability.spec.ts

Test data seeding contract (tiny contract for each spec):

- Inputs: tenant slug, admin user, creator user, regular user, sample rates percentages (0, 7, 19), event/template identifiers.
- Outputs: created entities IDs for navigation and assertions; stored imported tax rate IDs.
- Error modes: missing credentials (fallback to payload assertion), permission denied (permission spec), tenant isolation failures (fail fast).

Edge cases checklist:

- No compatible provider rates → block saves (covered)
- Imported rate becomes incompatible/inactive → label fallback + warn (covered)
- Discount drives price to zero → treat as free; no tax rate (covered)
- Zero percent → supported; shown as Incl. 0% Tax (covered)
- Deleted/deactivated imported rate in use → warn + continue or fail gracefully on provider error (covered)

Execution notes:

- Prefer creating self-contained tenants per test file to run in parallel safely.
- Use data-testid attributes when available; otherwise rely on stable labels copied from UI.
- For checkout assertions without external network, assert the constructed payment payload at the server boundary (e2e can read test logger capture or an exposed /test-only endpoint if available) and skip live payment intent confirmation.
- Where logs are required (FR-021, FR-023), assert via test reporter artifacts or log capture configured in e2e setup.

Readiness gates:

- Tests compile and run with seeded data in CI without Stripe credentials by using boundary payload assertions.
- When Stripe test credentials present, end-to-end checkout paths also validate the provider payload (tax rate id attached).

Deliverables:

- The spec-named files above under e2e/tests/... with consistent naming, each containing at least 1 happy-path and 1 edge/negative path aligned to the mapped FRs.
- Optional: update e2e/tests/test-inventory.md to reference TAX-RATES suite and spec coverage status.
