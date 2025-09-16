# Data Model: Tenant‑wide Discount Enablement with ESNcard

## Entities (new/updated)

### discount_type (enum)
Existing: `['esnCard']`. Leave as‑is; future providers add new literals via migrations.

### discount_card_status (enum)
Existing: `['unverified','verified','expired','invalid']`.

### tenants (existing)
- Field: `discount_providers` JSONB
  - Type: `Partial<Record<'esnCard', { status: 'enabled'|'disabled'; config: unknown }>>`
  - Notes:
    - Store `config.showCta?: boolean` to allow disabling ESN CTA (FR‑009).

### user_discount_cards (existing)
- Fields:
  - `type: discount_type` (e.g., `'esnCard'`)
  - `identifier: varchar(255)`
  - `status: discount_card_status`
  - `validFrom?: timestamp` | `validTo?: timestamp`
  - `lastCheckedAt?: timestamp`
  - `metadata?: jsonb`
  - `tenantId: varchar(20)`
  - `userId: varchar(20)`
- Indices/Constraints:
  - Unique `(type, identifier)` platform‑wide (FR‑006)
  - Unique `(tenantId, userId, type)` per user per tenant

### template_registration_options (existing) — PROPOSE add field
- `discounts?: Array<{ discountType: discount_type; discountedPrice: integer }>` stored as JSONB
- Rationale: consolidate provider-specific discounts into the option itself; simplifies reads/writes and duplication.

### event_registration_options (existing) — PROPOSE add field
- `discounts?: Array<{ discountType: discount_type; discountedPrice: integer }>` stored as JSONB
- Rationale: same as template; no extra table required.

### event_registrations (existing) — PROPOSE add fields
Add minimal snapshot for FR‑024 reporting and resilience:
- `basePriceAtRegistration: integer` NOT NULL
- `appliedDiscountType: discount_type` NULL
- `appliedDiscountedPrice: integer` NULL
- `discountAmount: integer` NULL

These are written at registration time based on effective pricing selection.

## Relationships
- tenant 1‑N user_discount_cards (scoped by tenant)
- user 1‑1(ish)/provider user_discount_cards (one per provider per tenant)
- template_registration_options 1‑N template_registration_option_discounts
- event_registration_options 1‑N event_registration_option_discounts
- event_registrations N‑1 event_registration_options; event_registrations store applied discount snapshot

## Validation Rules Summary
- Credential uniqueness platform‑wide by `(type, identifier)`.
- Provider disabled → hide in UI, block CRUD (server check) for new identifiers (FR‑004).
- ESN validation: adapter returns `verified` for status `active`; map expiration to `validTo`; else `invalid/expired` (FR‑008).
- Pricing writes must ensure `discountedPrice <= base price` (FR‑019/FR‑026).
- Eligibility for event: credential is `verified`, provider enabled for tenant, and `validTo` is null or `>= eventStart` (FR‑012/FR‑022).
- Tie‑breakers: if lowest discounted equals base price → prefer base; else alphabetical by provider type (FR‑021).

## Indices/Migrations
- No new tables.
- Add four snapshot columns to `event_registrations` via migration.
- Add `discounts` JSONB field to `template_registration_options` and `event_registration_options`.
- Backfill: read existing rows in `*_registration_option_discounts` tables, group by `registrationOptionId`, and write JSON arrays into the new `discounts` fields.
- Deprecate (and later drop) `template_registration_option_discounts` and `event_registration_option_discounts` after code switches to JSON fields.

## Non‑Functional Notes
- All amounts are tax‑inclusive; do not perform tax arithmetic here (FR‑019 note).
- Keep validation errors actionable.
