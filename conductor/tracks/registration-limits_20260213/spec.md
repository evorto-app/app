# Track Spec: Registration Limits + Deregistration Settings

## Overview

Add registration control settings for deregistration and tenant-wide rate limiting:

1. Per registration option:
   - Deregistration close timing
   - Paid-option toggle to refund payment fees on deregistration

2. Tenant-wide registration limits:
   - Daily and/or weekly limits
   - Shared global cap with optional stricter free/paid overrides
   - Optional inclusion of organizing registrations
   - Enforcement in registration UI with clear blocking message

This is a feature track focused on configurable registration governance and predictable user-facing enforcement.

## Functional Requirements

### 1. Deregistration Close on Registration Options

- Add a deregistration close attribute to registration options.
- Template registration options:
  - Store this value as a relative timing rule (aligned with existing template timing patterns).
- Event registration options (materialized from templates):
  - Persist an absolute cutoff timestamp derived from the template rule at event instantiation/update time.
- Deregistration must be blocked once the option's event-level absolute cutoff is passed.

### 2. Paid Deregistration Fee-Refund Toggle

- For paid registration options, add a toggle:
  - `refundPaymentFeesOnDeregistration` (name may vary in implementation).
- Behavior:
  - Enabled: refund full amount including payment fees.
  - Disabled: refund amount excluding payment fees.
- Toggle is irrelevant/hidden/disabled for free registration options (implementation detail can decide exact UX pattern).

### 3. Tenant-Wide Daily/Weekly Registration Limits

- Add tenant-level setting toggles to enable:
  - Daily registration limit
  - Weekly registration limit
- If enabled, each limit has a numeric cap.
- Use a shared global cap model, with optional stricter overrides for free and paid events:
  - Base limit applies to all registrations.
  - Optional per-type overrides can further constrain free or paid registrations.
- When both daily and weekly limits are enabled, user must satisfy both to register.

### 4. Limit Scope and Counting Rules

- Limits apply per user, scoped to tenant.
- Count only confirmed/successful registrations.
- Exclude non-confirmed states such as cancelled/waitlisted/failed attempts.
- Add tenant-level toggle to include organizing registrations in limit counters.
  - When off, organizing registrations are excluded.
  - When on, organizing registrations contribute like other qualifying registrations.

### 5. Enforcement Behavior in UI

- If user is over an active limit:
  - Hide registration option/CTA,
  - Show explanatory message instead,
  - Include the next eligible time/context where feasible.
- Limit checks must also be validated server-side at registration attempt time to avoid bypass via stale client state.

### 6. Admin Configuration UX

- Tenant admins can configure daily/weekly toggles and values.
- Tenant admins can configure free/paid overrides when enabled.
- Settings should be explicit and understandable:
  - show active rules summary,
  - show precedence/combined behavior when both daily+weekly are active.

### 7. Permissions and Tenant Isolation

- Only authorized tenant admins can change tenant-level registration limit settings.
- Registration option deregistration/refund settings follow existing event/template admin permissions.
- All counters/evaluations are tenant-isolated.

## Non-Functional Requirements

- Full type safety end-to-end for settings, counters, and enforcement responses.
- Consistent behavior between SSR/client rendered states and server validations.
- Low-latency eligibility checks suitable for registration pages.
- Deterministic time-window logic for day/week boundaries (single defined timezone strategy).

## Acceptance Criteria

1. Template registration options store deregistration cutoff as relative timing.
2. Event registration options persist absolute deregistration cutoff timestamps derived from template timing.
3. Deregistration is blocked after cutoff and allowed before cutoff.
4. Paid options expose fee-refund toggle; enabled refunds full amount incl. fees, disabled excludes fees.
5. Tenant admins can enable daily and/or weekly per-user limits and set numeric caps.
6. Shared global cap is supported with optional stricter free/paid overrides.
7. If both daily and weekly limits are active, both constraints are enforced.
8. Counting includes only confirmed registrations and excludes cancelled/waitlisted/failed.
9. Organizing registrations are included or excluded according to tenant toggle.
10. When blocked by limits, registration CTA is hidden and explanatory message is shown.
11. Server-side enforcement prevents registrations that exceed active limits even if client is stale.

## Out of Scope

- Cross-tenant/global platform rate limits.
- Dynamic pricing or surge policies tied to limits.
- Per-event custom limit schemas beyond free/paid split and global base cap.
- Historical analytics dashboards for limit consumption (unless minimally required for admin UX).
- Changes to unrelated payment/refund workflows beyond the new fee-refund toggle behavior.

## Suggested Additions (for future track consideration)

- Admin preview/simulator for "can user register?" with sample inputs.
- User-facing "remaining registrations this day/week" indicator.
- Audit log entries for settings changes impacting eligibility decisions.
