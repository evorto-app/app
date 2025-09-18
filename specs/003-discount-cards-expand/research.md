# Research: Tenant‑wide Discount Enablement with ESNcard

Date: 2025-09-16
Branch: `003-discount-cards-expand`
Spec: `/Users/hedde/code/evorto/specs/003-discount-cards-expand/spec.md`

## Context & Existing Implementation

A partial implementation already exists in the Evorto stack:
- DB (Drizzle):
  - `user_discount_cards` with fields: `type` (`discount_type` enum: `'esnCard'`), `identifier`, `status` (`discount_card_status` enum), `validFrom/validTo`, `lastCheckedAt`, `metadata`, uniqueness: `(type, identifier)` platform‑wide and `(tenantId, userId, type)` per user.
  - `template_registration_option_discounts` and `event_registration_option_discounts` with `discountType` (enum) and `discountedPrice` per registration option.
  - `tenants.discount_providers` JSONB for tenant enablement and provider config.
- Server (tRPC):
  - `discounts.router` with procedures: `getTenantProviders`, `setTenantProviders`, `getMyCards`, `upsertMyCard`, `refreshMyCard`, `deleteMyCard`.
  - Provider catalog and adapter in `src/server/discounts/providers` with ESN validation against `esncard.org`.
  - Registration flow applies the lowest eligible discount among verified cards for enabled providers; treats zero effective price as free.
  - Event creation copies template registration option discounts.
- Client (Angular 20):
  - Profile page shows ESNcard controls when ESN provider enabled.
  - Event details warn if card expires before event starts (basic).

This aligns strongly with FR‑001..FR‑014, FR‑017, FR‑019, FR‑021..FR‑023. Gaps and refinements remain below.

## Key Decisions

1. Provider Catalog Source of Truth
   - Decision: Keep catalog hard‑coded in `src/server/discounts/providers` with explicit `ProviderType` union and `PROVIDERS` record per spec FR‑001. This ensures typed contracts and simple enablement.
   - Alternatives: Store providers in DB; rejected for added complexity without functional gain.

2. Tenant Enablement Storage
   - Decision: Continue using `tenants.discount_providers` JSONB keyed by provider type with `{ status, config }` entries. Validate and normalize via tRPC.
   - Alternatives: Dedicated table; rejected for now to minimize model changes (FR‑020).

3. Credential Uniqueness and Verification
   - Decision: Reuse `user_discount_cards` with existing unique constraints enforcing platform‑wide `(type, identifier)` usage (FR‑006). Keep verification metadata and timestamps (FR‑007, FR‑008). Immediate server‑side validation on upsert; block if `status !== 'verified'` with actionable message.
   - Alternatives: Soft uniqueness per tenant; rejected—spec requires platform‑wide.

4. Discounted Price Definition
   - Decision: Reuse existing `*_registration_option_discounts` tables for template and event (FR‑010, FR‑011). Enforce validation that `discountedPrice <= base price` at write time (FR‑019, FR‑026).

5. Pricing Selection Rules
   - Decision: Keep current lowest‑price selection among enabled/verified/valid credentials, with two refinements to meet FR‑021/FR‑022:
     - Treat credentials valid on the event start date as eligible (`validTo >= eventStart` or null).
     - Tie‑breakers: prefer base price if equal; else alphabetical by provider type.

6. Registration Discount Summary Persistence
   - Decision: Add minimal fields to `event_registrations` to snapshot applied discount context for list/reporting (FR‑024) and resilience against future price changes:
     - `appliedDiscountType` (nullable `discount_type`)
     - `basePriceAtRegistration` (int)
     - `appliedDiscountedPrice` (nullable int)
     - `discountAmount` (nullable int)
   - Alternatives: Compute dynamically each view; rejected due to drift if options/prices change post‑registration and to satisfy auditable reporting.

7. Auditability
   - Decision: Record tenant provider toggles via existing update flows with structured logs. Consider optional lightweight `audit_events` table in a follow‑up if needed for FR‑016; for this iteration, capture logs with actor and timestamps in server actions where available.

8. User Education / CTA
   - Decision: When ESN provider is enabled and user has no verified ESNcard, show guidance and “Get your ESNcard” CTA in profile and during relevant registration contexts (FR‑009, FR‑010). Allow tenant config flag to disable CTA (store under `discountProviders.esnCard.config.showCta?: boolean = true`).

## Unknowns → Resolutions

- Provider outages/timeouts handling (FR‑017/FR‑025): adapter returns `unverified` on non‑OK or exception; UI will surface “service unavailable” message and allow retry; no automatic retries.
- Permissions (FR‑018): continue using `admin:changeSettings` meta for toggles; users can only manipulate their own `user_discount_cards` entries; organizers rely on existing event permissions.
- Event browsing warning (FR‑014): ensure event details fetches current cards and event start to compute expiration warnings; refine copy.

## Best Practices & References

- Angular 20: standalone components, signals, typed TanStack Query; Material 3 with Tailwind token mapping; use `<fa-duotone-icon>` for icons (per constitution).
- Drizzle: typed enums, JSONB, unique constraints, migrations idempotent; add new columns via migrations.
- tRPC + Effect Schema: every procedure inputs/outputs validated; avoid `any`.
- E2E‑first TDD: add Playwright tests for admin toggles, profile card CRUD/validation, registration pricing including zero‑price path, tie‑breakers, and mid‑flow toggle.

## Alternatives Considered

- Storing providers in DB tables vs JSONB: rejected (complexity, no benefit now).
- Adding separate `registration_discounts` table: rejected for now; minimal columns on `event_registrations` preferred.
- Delaying Registration Discount Summary storage: possible but risks FR‑024; chose to store minimal snapshot.

## Outcome

- Proceed with minimal schema additions to `event_registrations` and validation guards.
- Implement tie‑breaking and validity‑on‑start refinements in server pricing logic.
- Complete UI surfaces and docs/tests per spec.

---

All spec ambiguities resolved for this iteration. Next: Phase 1 design & contracts.
