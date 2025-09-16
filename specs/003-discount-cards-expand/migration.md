# Migration Plan: Tenant‑wide Discount Enablement

This document describes a TypeScript-based data migration from the old database schema (source) to the planned target model for this feature (see data-model and contracts). No raw SQL migrations are required—implementation will follow the repository’s `migration` framework (see `migration/index.ts`). It covers the necessary target fields, backfills, idempotency, and verification.

## Target Changes (as per feature plan)
1) Persist price snapshot on registrations (reporting/audit)
   - `event_registrations` add:
     - `basePriceAtRegistration` (int, cents)
     - `appliedDiscountType` (`discount_type` enum; e.g., `'esnCard' | 'none' | 'other' | 'unknown'`)
     - `appliedDiscountedPrice` (int, cents, nullable)
     - `discountAmount` (int, cents, nullable)
2) Consolidate discounts into registration options
   - `template_registration_options.discounts` JSONB → `[{ discountType, discountedPrice }]`
   - `event_registration_options.discounts` JSONB → `[{ discountType, discountedPrice }]`
3) Deprecations (post-cutover)
   - Old per-option discount tables in the new app (if present) will be deprecated in favor of the consolidated JSON. Dropping happens later after verification.

## TypeScript Migration Approach (old → target)

Source (old DB):
- `User`: `esnCardNumber`, `esnCardValidUntil`, `esnCardOverride`, `createdAt`, `id`
- `TumiEvent`: `prices` (jsonb), `deferredPayment` (bool), `id`, `tenantId`, `registrationMode`
- `EventRegistration`: `id`, `createdAt`, `userId`, `eventId`, `status`, `type`
- `Transaction`: `eventRegistrationId`, `status`, `direction`, `amount`

Target (planned):
- `user_discount_cards`: one `esnCard` per user/tenant with normalized identifier and status
- `event_registration_options` (+ templates): consolidated `discounts` JSONB
- `event_registrations`: snapshot fields listed above

Implementation medium: TypeScript migration steps under `migration/steps`, invoked from `migration/index.ts` per tenant. Batching and idempotency align with existing steps like `events.ts`.

### Step 1 — Migrate ESNcards (User → user_discount_cards)
- For each old user with `esnCardNumber`:
   - Normalize identifier: uppercase, remove spaces/dashes.
   - Derive status at migration time:
      - `verified` if `esnCardOverride = true` OR `esnCardValidUntil >= now()`
      - `expired` if `esnCardValidUntil < now()`
      - otherwise `unverified`
   - Map old user → new user via `mapUserId`/`resolveUserId`.
   - Upsert into `user_discount_cards` on `(tenantId, userId, type='esnCard')` and enforce uniqueness `(type, identifier)`.
   - Set `validTo` from `esnCardValidUntil`; keep `metadata` minimal (e.g., `{ source: 'old' }`).
- Idempotent: on conflict, only update fields when values differ; never create duplicates.

### Step 2 — Derive event price tiers (TumiEvent.prices → option discounts)
- Parse old `TumiEvent.prices` per event:
   - If `prices.options` is an array: find participant base price (non-ESN, allowedStatus includes `'NONE'`), and ESN price (entries with `esnCardRequired`), convert to cents.
   - Else, if map-like: pick max numeric as base; any ESN-labeled entry as ESN price.
- For each migrated event in the new app:
   - Ensure there is a participant registration option; set its `price` to the derived base (already done in `events.ts` where possible).
   - Populate `event_registration_options.discounts` JSONB with an ESN entry when derived, e.g., `[{ discountType: 'esnCard', discountedPrice: esnPriceCents }]`.
- Idempotent: build a deterministic array (sorted by `discountType`, then `discountedPrice`); only update if different.

### Step 3 — Backfill registration snapshots (EventRegistration/Transaction → event_registrations.*)
- For each old registration:
   - Compute net paid from confirmed transactions:
      - Incoming = sum of `direction in ('USER_TO_TUMI','EXTERNAL_TO_TUMI')`
      - Refunds = sum of `direction in ('TUMI_TO_USER','EXTERNAL_TO_USER')`
      - `netPaid = incoming − refunds` (convert to cents consistently)
   - Determine candidate prices: `{ basePriceCents, esnPriceCents? }` and any other participant prices if available.
   - Match `netPaid` to a candidate within ±1 cent.
   - Infer discount type:
      - Equal to base → `none`
      - Lower than base → if ESN tier or user had active ESN at registration time (`override` true or `validUntil >= registration.createdAt`) → `esnCard`; else `other`
      - No match: if free event and `netPaid = 0` → `none`; if deferred payment and `netPaid = 0` → `unknown`; else `unknown`.
   - Write snapshot on the corresponding new registration:
      - `basePriceAtRegistration = basePriceCents`
      - `appliedPricePaid = netPaid`
      - `appliedDiscountType = 'none'|'esnCard'|'other'|'unknown'`
      - `appliedDiscountedPrice = matchedLowerTierPrice || null`
      - `discountAmount = max(base - appliedDiscountedPrice, 0)`
- Idempotent: only fill null fields or re-write when equal; log conflicts.

### Step 4 — Verification & Reporting
- Counts:
   - ESNcards migrated vs users with `esnCardNumber` in old DB.
   - Events with derived ESN discount applied to options.
   - Registrations with snapshots set.
- Spot checks:
   - Random samples per discount type (`none`, `esnCard`, `other`, `unknown`).
   - Sum of `appliedPricePaid` vs sum of confirmed incoming minus refunds per tenant (within tolerance).
- Anomalies:
   - Ambiguous or missing price matches, currency mismatches, duplicate ESN identifiers → log and continue; produce a CSV report for follow-up.

## Validation & Guards
- For discounts JSON: enforce `discountedPrice <= base price` before write.
- Ensure `discount_type` enum includes `'esnCard'` (already present in the plan).
- Respect unique indices on `user_discount_cards`.

## Verification
- Pricing smoke test: pick events and verify that lowest price selection matches the old behavior for representative cases (base, ESN, free, deferred).
- Compare pre/post aggregates where applicable; store a short verification log per tenant.

## Rollout
- Phase A: Add required new fields in the new app schema (part of feature development).
- Phase B: Execute the TypeScript migration steps per tenant after the new version goes live (read-only from old DB, write to new DB).
- Phase C: Switch server logic fully to consolidated discounts (if not already) and rely on snapshots.
- Phase D: Deprecate/remove any now-unused discount tables in the new app after verification.

## Seeds
- Provider catalog (hard-coded) remains. If needed, seed `tenants.discount_providers` defaults as part of app setup, not this migration.

## Failure Handling
- Steps are idempotent; safe to re-run. Partial failures can resume on next run.
- Log invalid/missing data and continue. Export a CSV/report for admin review.
