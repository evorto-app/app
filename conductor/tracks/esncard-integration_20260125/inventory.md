# ESNcard Integration Inventory

## Data Model
- `src/db/schema/user-discount-cards.ts`: Stores discount card records per user/tenant with `identifier`, `status`, `validFrom`, `validTo`, `metadata`, and `type` (enum includes `esnCard`).
- `src/db/schema/tenants.ts`: `discountProviders` JSONB stores per-tenant enablement + CTA config.
- `src/db/schema/event-registration-options.ts`: `discounts` JSONB array with `{ discountedPrice, discountType }`.
- `src/db/schema/template-registration-options.ts`: Same `discounts` JSONB array at template level.
- `src/db/schema/event-registrations.ts`: Pricing snapshot fields `appliedDiscountType`, `appliedDiscountedPrice`, `discountAmount`, `basePriceAtRegistration`.

## Server Flows
- Provider validation: `src/server/discounts/providers/index.ts` calls `https://esncard.org/services/1.0/card.json?code=...` and returns `verified/expired/invalid/unverified` + `validTo`.
- Tenant configuration:
  - `src/server/trpc/discounts/discounts.router.ts`:
    - `getTenantProviders`: reads `tenant.discountProviders`, maps legacy `status` to `enabled`.
    - `setTenantProviders`: persists `enabled` + CTA config.
- User card lifecycle:
  - `upsertMyCard`: validates ESNcard on save, stores status + validity.
  - `refreshMyCard`: revalidates and updates status + validity.
  - `deleteMyCard`, `getMyCards`: manage stored cards.
- Discount validation: `src/server/utils/validate-discounts.ts` ensures paid option, no duplicate types, price <= base.
- Registration pricing:
  - `src/server/trpc/events/register-for-event.procedure.ts`:
    - Determines eligible discounts from verified cards + enabled providers.
    - Enforces `validTo` > event start.
    - Applies lowest price and stores pricing snapshot on registration.
    - Recomputes effective price for Stripe session.
- Template + event flows:
  - `src/server/trpc/templates/template.router.ts` and `src/server/trpc/events/events.router.ts` accept and persist `discounts`.

## Client Flows
- Admin toggle + CTA:
  - `src/app/admin/discount-settings/discount-settings.component.*` manages ESNcard enablement + CTA link.
  - `src/app/admin/general-settings/general-settings.component.*` surfaces provider overview.
- Profile:
  - `src/app/profile/discount-cards/discount-cards.component.*` allows add/refresh/delete ESNcard and shows CTA.
  - `src/app/profile/user-profile/user-profile.component.*` also exposes ESNcard management.
- Event editor:
  - `src/app/shared/components/forms/registration-option-form/*` shows discount pricing when provider enabled.
- Registration UX:
  - `src/app/events/event-registration-option/*` computes best discount client-side and displays price, savings, and eligibility messaging.
  - `src/app/events/event-details/event-details.component.*` warns when card expires before event start.
- Scanning/organizer:
- `src/app/scanning/handle-registration/*` shows registration details but does not surface `appliedDiscountType`.
- `src/app/events/event-organize/*` does not surface discount markers.

## Data Model Adjustments
- No new fields required; current schema covers card validity (`user_discount_cards.validTo`) and discount snapshots (`event_registrations.appliedDiscountType`, `appliedDiscountedPrice`, `discountAmount`).
- No migrations identified for this phase.
