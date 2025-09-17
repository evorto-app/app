# Research: Registration cancellation configuration

Date: 2025-09-17
Branch: `004-registration-cancellation-configuration`
Spec: `/Users/hedde/code/duplicates/evorto/specs/004-registration-cancellation-configuration/spec.md`

## Context & Existing Implementation

- DB (Drizzle):
  - `event_instances` with `start`/`end` timestamps.
  - `event_registration_options` and `template_registration_options` with `isPaid`, base `price`, and registration windows.
  - `event_registrations` with status enum (`PENDING|CONFIRMED|CANCELLED|WAITLIST`), `paymentStatus` (`PENDING|PAID|REFUNDED`), and links to options/events/users.
  - `transactions` capturing payments and refunds with amounts, fees (`stripeFee`, `appFee`), and status (`pending|successful|cancelled`).
- Server (tRPC):
  - `events.registerForEvent` handles registration and payment. `events.cancelPendingRegistration` exists for cancelling pending bookings before payment finalization.
  - Stripe webhook updates transaction/registration states.
- Client (Angular 20):
  - Active registration component shows a "Cancel registration" action for pending states.
  - Registration options UI exists on templates/events.

## Key Decisions

1. Policy Storage and Inheritance
- Decision: Store tenant default policies in `tenants.cancellationPolicies` (JSONB), with up to four variants: `paid|free` × `regular|organizer`. Store per‑option override in `template_registration_options.cancellationPolicy` and copy to `event_registration_options.cancellationPolicy`, with a boolean `useTenantDefault` flag on options to indicate inheritance. Only relative cutoff (days + hours) is stored.
- Alternatives: Separate tables; rejected to keep schema changes minimal and co‑locate with existing option records.

2. Effective Policy Snapshot at Purchase
- Decision: At registration time, compute and persist a snapshot of the effective policy on `event_registrations.effectiveCancellationPolicy` (JSONB) and `effectivePolicySource: 'tenant'|'option'`. This meets FR‑012 and avoids ambiguity when policies change later.
- Alternatives: Resolve at cancel time; rejected due to immutability requirement.

3. Refund Composition
- Decision: For paid registrations within window, compute refund as the amount paid after discounts. When `includeTransactionFees` and/or `includeAppFees` are false, keep fees by subtracting them from the refunded amount; when a full refund is selected (policy or admin override), refund the full amount paid and tenant covers non‑refundable processor fees as per platform policy (FR‑014). Use existing `transactions` with `type='refund'` to record refunds and attach Stripe references.
- Alternatives: Introduce fee lines per refund; unnecessary for now.

4. Progressive Disclosure UI
- Decision: Combined form with a single policy editor (allow cancel, days/hours, include fees) and an "Apply to all variants" toggle. Users can expand an advanced section to override per variant. At option level, a simple switch "Use tenant default" reveals or hides the custom policy form.
- Alternatives: Four separate forms; rejected for complexity.

5. Authorization & Visibility
- Decision: Reuse existing permissions (admin/organizer) consistent with template/option editing. Hide cancel action when outside policy or disabled (FR‑016).

6. Cutoff Evaluation
- Decision: Evaluate eligibility by comparing `now` to `event_instances.start - (days*24 + hours)`. Precision: second‑level; no DST special cases. Store only relative values in snapshot; always calculate against current event start (FR edge case).

7. Contracts Format (tRPC + Effect Schema)
- Decision: No OpenAPI artifacts. Define request/response contracts via tRPC using Effect Schema inputs/outputs. Planning artifacts capture TypeScript/Effect Schema shapes in markdown (`contracts/contracts.md`).

8. Event Creation From Template — Editable Policy
- Decision: The event creation flow uses a single large form, prefilled from the template. Users can change cancellation policy for any registration option at this step; the server persists these edits to the newly created event options.

9. Migration Snapshot Backfill (Old Data Model)
- Decision: During the migration introducing `effectiveCancellationPolicy`, compute and write a snapshot for existing registrations. For the prototype, derive the snapshot from the current option override or tenant default (variant determined by option `isPaid` and `organizingRegistration`). Document that historical drift may exist; acceptable for the prototype.

10. Pending Registrations Unaffected
- Decision: Keep `events.cancelPendingRegistration` behavior as-is; the new cancellation feature applies to confirmed, paid/free registrations only.

## Unknowns → Resolutions

- Existing registrations without snapshot: resolved by migration backfill; cancel-time fallback no longer necessary in this prototype.
- Handling payments in progress (PENDING):
  - Resolution: Reuse `cancelPendingRegistrationProcedure` for pre‑success cancellations (FR‑015). For post‑success within window, issue refund.
- Organizer vs regular detection:
  - Resolution: Use `event_registration_options.organizingRegistration` to derive role in policy resolution.

## Best Practices & References

- Angular 20: standalone components, typed non‑nullable forms, native control flow, signals, Material 3 + Tailwind tokens.
- Drizzle: additive JSONB fields + enums, idempotent migrations, derived types.
- tRPC + Effect Schema: strict input/output schemas, no `any`, end‑to‑end types.
- Stripe/Refunds: initiate refunds in cancel procedure using the tenant’s `stripeAccountId`; rely on Stripe webhooks (`charge.refunded`) to persist the refund transaction asynchronously and idempotently.
- Permissions: participants can cancel their own registrations when allowed by policy; admins/organizers may cancel per existing event permissions; optional `cancellationReason` captured for audit.
- E2E‑first TDD: write Playwright tests for tenant config, option inheritance/override, cancellation flows, refund composition, and hidden actions.

## Permissions (New Requirements)

- `events:registrations:cancel:any` — Required to cancel another user’s registration (i.e., not self-cancellation).
- `events:registrations:cancelWithoutRefund` — Required to cancel a paid registration without issuing a refund (policy may still allow refund; this permission authorizes opting out).

UI should reflect permissions by enabling the “cancel without refund” option only when the actor holds the permission.

## Cancellation Reason Enum

Introduce a `cancellationReason` enum to standardize reasons and improve event overview clarity:
- `user` — cancelled by the participant
- `admin` — cancelled by an administrator or authorized staff
- `organizer` — organizer self‑removal
- `payment_abandoned` — pending payment cancelled/expired
- `other` — fallback category for unforeseen cases

Optional `cancellationReasonNote` (free text) is allowed when `reason = 'other'` to provide context. The event overview should display a user‑friendly label for the reason (and the note when `other`).

## Alternatives Considered

- Storing absolute cutoff timestamps on registrations: rejected due to event time changes; relative snapshot required by spec.
- Fee calculation via separate fee table: rejected; reuse `transactions` fields (`stripeFee`, `appFee`).

## Outcome

- Minimal schema changes with JSONB policy storage and a registration snapshot.
- Progressive disclosure UI integrated into existing settings and option forms.
- Tests and docs planned to validate all acceptance criteria.
