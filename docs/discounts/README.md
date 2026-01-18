# Discounts System Snapshot

Date: 2026-01-18

This note captures the current state of the discounts feature so we do not have to rediscover it later. It focuses on ESNcard because that is the only provider wired end-to-end today.

## Data model (current)

- Tenant configuration: `tenants.discount_providers` (JSON)
  - Shape used by UI: `{ esnCard?: { enabled: boolean; config?: { ctaEnabled?: boolean; ctaLink?: string } } }`
  - Stored via `src/server/trpc/discounts/discounts.router.ts`.
- User cards: `user_discount_cards` table
  - Tracks identifier, status, validity dates, metadata, and timestamps.
- Registration options (templates and events): `discounts` JSON array on `template_registration_options` and `event_registration_options`.
  - Each entry: `{ discountedPrice: number; discountType: 'esnCard' }`.
- Registration snapshot: `event_registrations` stores `appliedDiscountType`, `appliedDiscountedPrice`, and `discountAmount`.

## Main flows

1. Admin enables provider
   - UI: `src/app/admin/discount-settings/*`
   - API: `discounts.setTenantProviders`
2. User adds a card
   - UI: `src/app/profile/discount-cards/*` (and CTA on profile page)
   - API: `discounts.upsertMyCard` (validates card via provider adapter)
3. Organizer configures discounts on registration options
   - UI: `src/app/shared/components/forms/registration-option-form/*`
4. Participant registers
   - UI: `src/app/events/event-registration-option/*` (shows best discount)
   - API: `events.registerForEvent` (applies best eligible discount and stores snapshot)

## External dependency

- Provider adapter in `src/server/discounts/providers/index.ts` calls `https://esncard.org/services/1.0/card.json`.

## Test coverage map

Documentation journeys:
- `e2e/tests/docs/discounts/discounts.doc.ts` (admin + member flow)
- `e2e/tests/docs/profile/discounts.doc.ts` (profile CTA)

Contract/regression:
- `e2e/tests/specs/contracts/discounts/*.spec.ts`
- `e2e/tests/specs/finance/discounts/esn-discounts.test.ts`
- `e2e/tests/specs/contracts/templates/templates.discounts.duplication.spec.ts`

Known TODO placeholders:
- `e2e/tests/specs/events/price-labels-inclusive.spec.ts`
- `e2e/tests/specs/finance/checkout/checkout-uses-tax-rate-id.spec.ts`

## Known gaps / cleanup targets

- UI eligibility checks do not validate card validity dates (server does).
- Discount selection logic is duplicated in `register-for-event.procedure.ts` (transaction + Stripe flow).
- Provider config validation is now specific to ESNcard and only stores the enable + CTA settings.

## Next decisions to make

- Do we keep ESNcard as a built-in provider only, or formalize a generic provider interface?
- Should ESN validation be required on every upsert, or can we allow unverified cards and validate lazily?
- Do we want UI to reflect event date eligibility (validTo vs event start) to reduce surprises at checkout?

## Suggested cleanup sequence (fast path)

1. Centralize discount selection in a single server utility and use it for both transaction + Stripe flows.
2. Replace TODO placeholders in e2e specs with either real steps or explicit `test.skip` + reason.
