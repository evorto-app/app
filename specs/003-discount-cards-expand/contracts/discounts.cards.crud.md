# Contract: discounts.cards (User Credentials CRUD + Validation)

- getMyCards: query → `Array<UserDiscountCard>` for current user/tenant
- upsertMyCard: mutation `{ type: 'esnCard', identifier: string }` → `UserDiscountCard`
  - Errors:
    - Provider disabled (FR‑004)
    - Identifier already in use by another user (FR‑006)
    - Validation not active/verified (FR‑008/FR‑015)
  - Behavior: Upsert then validate immediately via provider adapter; set status/validity/metadata. There is no separate refresh route; users can re‑enter the identifier to revalidate if needed.
- deleteMyCard: mutation `{ type: 'esnCard' }` → void

Types: `UserDiscountCard = { id, tenantId, userId, type, identifier, status, validFrom?, validTo?, lastCheckedAt?, metadata? }`
