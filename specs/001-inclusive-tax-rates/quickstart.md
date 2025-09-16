# Quickstart: Inclusive Tax Rates Feature

Purpose: Sequenced implementation & validation guide (cross‑references design artifacts).
+See also: `/specs/001-inclusive-tax-rates/e2e-plan.md` for the full Playwright E2E mapping and file layout.

## 0. Prerequisites

- Read: `plan.md`, `research.md`, `data-model.md`, `migration.md`, `contracts/`.
- Ensure Stripe test credentials & tenant `stripeReducedTaxRate` configured where needed.
- Confirm new permission `admin:manageTaxes` exists and granted to appropriate admin roles (migration auto-grant from existing `admin:changeSettings`).

## 1. Migrations & Seeds (Server First)

Refer: `data-model.md` (Migration Impact), `migration.md`.

1. Create unique index `(tenantId, stripeTaxRateId)`.
2. Implement migration step to import default tax rate (tenant.stripeReducedTaxRate) + assign to legacy paid options.
3. Dev-only seed sample rates (0%,7%,19%).
4. Verification queries (see `migration.md`).

## 2. tRPC Contracts & Schemas

Refer: `contracts/` files.
Implement procedures (inputs/outputs validated by Effect Schema):

- `admin.tenant.listStripeTaxRates`
- `admin.tenant.importStripeTaxRates`
- `admin.tenant.listImportedTaxRates`
- `taxRates.listActive`
  Augment existing mutations:
- Templates: create/update (tax validation)
- Events: create (tax validation)
- Events: registerForEvent (checkout tax_rates inclusion)

## 3. Validation Logic

Refer: `data-model.md` (Validation Summary), `templates.validation.md`, `events.create.validation.md`.
Rules enforced server-side only (UI assists):

- Paid → must have compatible inclusive+active rate.
- Free → must not have rate.
- Incompatible / cross-tenant → error codes: ERR_PAID_REQUIRES_TAX_RATE, ERR_FREE_CANNOT_HAVE_TAX_RATE, ERR_INCOMPATIBLE_TAX_RATE.

## 4. Admin UI (Import & Listing)

Flow:

1. Settings → Tax Rates → Import dialog calls `admin.tenant.listStripeTaxRates`.
2. Disable selection for non-inclusive or inactive.
3. Submit selected IDs to `admin.tenant.importStripeTaxRates`.
4. Refresh imported rates list via `admin.tenant.listImportedTaxRates`.
5. Show/Hide UI actions based on `admin:manageTaxes` permission (guard at routing/service layer).

## 5. Creator Forms (Templates & Events)

- Source rates with `taxRates.listActive` (TanStack Query + signals cache layer).
- Reactive form behavior: toggle isPaid sets/clears and enables/disables taxRate control (NonNullableFormBuilder).
- Validator: required when enabled.

## 6. Display Layer

- Component/Pipe to render inclusive label: `Incl. {percentage}% {displayName}`.
- Fallback: `Incl. Tax` if unresolved (e.g., removed later).
- Apply in template details, event details, registration summary, checkout review.

## 7. Checkout Integration

Refer: `events.registerForEvent.md`.

- Include `tax_rates=[stripeTaxRateId]` if present.
- Log warning if imported rate now inactive; still proceed.

## 8. E2E Tests (Before Implementation – RED)

Scenarios (map to FRs):

1. Admin imports rates (FR-002, FR-006, FR-024 permission gate).
2. Creator must select rate for paid option (FR-008, FR-009, FR-010).
3. Inclusive label shown on event page (FR-011, FR-017).
4. Checkout includes tax rate ID & final price (FR-012, FR-015).
5. Fallback label when rate unresolved (FR-013, FR-017).
6. Migration assigns legacy options default rate (FR-015).

## 9. Logging & Observability

Emit structured logs:

- import.success, import.skipIncompatible
- validation.error (with code)
- checkout.inactiveRateWarning
- label.fallbackUsed
- migration.assignment

## 10. Edge Cases

- Discount reduces price <= 0 → treat as free; remove tax rate at checkout.
- 0% inclusive → still show `Incl. 0% Tax`.
- Missing tenant.stripeReducedTaxRate in migration → log + admin warning.

## 11. Implementation Order Recap

1. Migration/index & seed.
2. Contracts + schemas.
3. Validation logic in template/event create/update.
4. Checkout tax rate wiring.
5. Admin UI import + list.
6. Creator forms enable/disable & selection.
7. Label component & fallback handling.
8. Logging instrumentation.
9. Final E2E stabilization.

## 12. Completion Checklist

- All paid options have rate or are free.
- All FRs covered (see coverage matrix in `plan.md`).
- E2E + contract tests green.
- No lint/type errors.
- Logs observable for key flows.

## Legacy Flow Example

1. Migration runs, assigns default rate to legacy paid options.
2. Admin can still import more rates; creators may switch selected rate later.
