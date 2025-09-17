# Contracts (tRPC + Effect Schema) — Registration cancellation configuration

This document outlines the planned tRPC procedures and Effect Schema shapes for cancellation policies and actions. It complements the spec and data model without prescribing final code.

## Effect Schema shapes (TypeScript notation)

```ts
// pseudo-import for illustration only
import * as S from 'effect/Schema';

export const CancellationPolicy = S.Struct({
  allowCancellation: S.Boolean,
  includeTransactionFees: S.Boolean,
  includeAppFees: S.Boolean,
  cutoffDays: S.Number.pipe(S.int(), S.nonNegative()),
  cutoffHours: S.Number.pipe(S.int(), S.between(0, 23)),
});

export const PolicyVariant = S.Literal(
  'paid-regular',
  'paid-organizer',
  'free-regular',
  'free-organizer',
);

export const TenantCancellationPolicies = S.Record({
  key: PolicyVariant,
  value: CancellationPolicy,
});

export const CancellationReason = S.Literal(
  'user',
  'admin',
  'organizer',
  'payment_abandoned',
  'other',
);

// Tenants: set policies (progressive disclosure)
export const SetTenantPoliciesInput = S.Struct({
  applyToAll: S.Boolean,
  policy: CancellationPolicy,
  overrides: S.optional(TenantCancellationPolicies), // per-variant overrides when provided
});

export const GetTenantPoliciesOutput = S.Struct({
  policies: S.optional(TenantCancellationPolicies),
});

// Options: inheritance toggle + optional override policy
export const OptionPolicy = S.Struct({
  useTenantDefault: S.Boolean,
  policy: S.optional(CancellationPolicy),
});

// Cancel request & result semantics
export const CancelRegistrationInput = S.Struct({
  registrationId: S.String,
  reason: S.optional(CancellationReason),
  reasonNote: S.optional(S.String), // used when reason = 'other'
  noRefund: S.optional(S.Boolean), // honored only if actor has permission and event is paid
});

export const CancellationResult = S.Struct({
  cancelled: S.Boolean,
  refunded: S.Boolean,
  refundAmount: S.Number.pipe(S.int(), S.nonNegative()),
  includesTransactionFees: S.Boolean,
  includesAppFees: S.Boolean,
});
```

## tRPC procedures (high level)

- `tenants.getCancellationPolicies()` → `GetTenantPoliciesOutput`
- `tenants.setCancellationPolicies(input: SetTenantPoliciesInput)` → `void`
- `options.getCancellationPolicy(optionId: string)` → `OptionPolicy`
- `options.setCancellationPolicy(optionId: string, input: OptionPolicy)` → `void`
- `events.cancelRegistration(input: CancelRegistrationInput)` → `CancellationResult`

Notes:
- `events.registerForEvent(...)` will snapshot the effective policy to `event_registrations` at the moment of purchase. Pending registration cancellation is already implemented via `events.cancelPendingRegistration` and remains unchanged.
- When creating an event from a template, the server will accept cancellation policy edits coming from the prefilled, single large form (see UI behavior below) and persist them on the new event’s registration options.
 - Refund processing is asynchronous: the cancel procedure initiates a refund with Stripe and updates the registration immediately; the webhook (`charge.refunded`) confirms and records the refund transaction. The cancel result returns the intended refund composition and amount.

Permissions:
- Cancelling another user’s registration requires `events:registrations:cancel:any`.
- Requesting `noRefund: true` on paid registrations requires `events:registrations:cancelWithoutRefund`.

## UI behavior integration points

- Admin Settings → Cancellations: reads/writes tenant policies with a single combined editor and per-variant advanced overrides.
- Template Option editor: toggle inheritance or set a custom option policy.
- Create Event from Template: large, prefilled form allows modifying any field, including cancellation policy for each option before the event is created.
- Registration detail: shows policy summary and cancel action (only when allowed by snapshot/policy evaluation).
