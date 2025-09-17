# Data Model: Registration cancellation configuration

## New/Updated Entities

### tenants (existing) — PROPOSE add field
- Field: `cancellationPolicies` JSONB
  - Type:
    ```ts
    type CancellationPolicy = {
      allowCancellation: boolean;
      includeTransactionFees: boolean;
      includeAppFees: boolean;
      cutoffDays: number; // >= 0
      cutoffHours: number; // 0..23
    };
    type PolicyVariant = 'paid-regular'|'paid-organizer'|'free-regular'|'free-organizer';
    type TenantCancellationPolicies = Partial<Record<PolicyVariant, CancellationPolicy>>;
    ```
  - Notes: up to four variants; progressive disclosure UI can write the same policy to all.

### template_registration_options (existing) — PROPOSE add fields
- `useTenantCancellationPolicy: boolean` (default true)
- `cancellationPolicy?: CancellationPolicy` (JSONB) used only when `useTenantCancellationPolicy=false`

### event_registration_options (existing) — PROPOSE add fields
- `useTenantCancellationPolicy: boolean` (copied from template when creating event)
- `cancellationPolicy?: CancellationPolicy` (JSONB) used only when not inheriting
  - Note: When creating an event from a template, the large prefilled form allows editing these fields before event creation.

### event_registrations (existing) — PROPOSE add fields
- `effectiveCancellationPolicy: CancellationPolicy` (JSONB) NOT NULL — snapshot at purchase time
- `effectivePolicySource: 'tenant'|'option'` (varchar) — optional for audit/debug
- `cancelledAt?: timestamp` — when user cancels successfully
- `refundTransactionId?: varchar` — link to `transactions.id` when a refund is created
- `cancellationReason?: text` — optional human-readable context (e.g., user‑initiated vs admin‑initiated)
  - Replace with enum for consistency: see `cancellationReasonEnum` below.
- `cancellationReasonNote?: text` — optional note shown when reason is `other`

### transactions (existing)
- Reuse `type='refund'` records to represent refunds; `stripeFee`/`appFee` fields already present and can reflect costs kept by tenant when not refunded to user.

## Relationships
- tenant 1‑N templates/events/options; options store inheritance flag and optional override policy.
- registration N‑1 user, event, and option; registration stores immutable policy snapshot.

## Validation Rules
- `cutoffDays >= 0` and `0 <= cutoffHours <= 23`; if `allowCancellation=false` then fees/cutoff are ignored.
- For free options, refunds are not created; capacity is released.
- For paid options within window, refund amount is based on amount paid after discounts; fee inclusion flags determine whether to subtract fees before refunding.
- If outside cutoff or `allowCancellation=false`, cancellation is blocked; UI hides action.

## Migrations (Additive)
- Add JSONB `cancellation_policies` to `tenants`.
- Add `use_tenant_cancellation_policy` (boolean, default true) and optional JSONB `cancellation_policy` to `template_registration_options` and `event_registration_options`.
- Add JSONB `effective_cancellation_policy`, `effective_policy_source` (varchar), `cancelled_at` (timestamp), and `refund_transaction_id` (varchar) to `event_registrations`.
- Add `cancellation_reason` enum with values: `user`, `admin`, `organizer`, `payment_abandoned`, `other`.
- Add `cancellation_reason` (enum) and `cancellation_reason_note` (text) to `event_registrations`.
- Backfill strategy: compute `effective_cancellation_policy` for existing registrations during migration from current policies (variant determined by registration option’s `isPaid` and `organizingRegistration`). Pending registrations path remains unaffected.

## Non‑Functional Notes
- Store only relative values; evaluate against current `event_instances.start` at cancellation time.
- End‑to‑end types via Effect Schema on tRPC inputs/outputs.
 - Optional `cancellationReason` improves audit readability beyond structured logs; keep short and optional.
 - Use standardized reason enum for consistent UI labels in event overviews; display `cancellationReasonNote` when reason is `other`.
