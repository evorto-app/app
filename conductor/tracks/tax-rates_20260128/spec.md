# Tax Rates (Stripe-Synced, Read-Only)

## Overview

Enable admins (or users with `admin:tax`) to manage tenant tax rates in a read-only view synced from Stripe. Event creators must select a tax rate for paid registration options, and the chosen tax rate must be forwarded to Stripe when creating payments and recorded on the registration. This track is created after implementation; we will align the existing feature to this target state.

## Functional Requirements

1. **Permissions & Access**
   - Only users with `admin:tax` can access the tax-rate list screen under `admin/` routes.
   - Tax rates are visible elsewhere for selection (e.g., in event registration pricing) but the list is not directly accessible without `admin:tax`.

2. **Stripe Sync (Read-Only, Explicit Trigger)**
   - Tax rates are synced **only when an authorized user explicitly triggers a sync action**.
   - The in-app list is read-only; changes can only be made in Stripe.
   - Only **inclusive** tax rates are allowed in the app. Non-inclusive tax rates should be filtered out or rejected.

3. **Event Pricing UX**
   - For **paid** registration options, selecting a tax rate is **required**.
   - For **free** registration options, the tax-rate selector is **hidden**.

4. **Payments + Registration Recording**
   - When creating a Stripe payment, forward the selected Stripe tax rate.
   - Persist on the registration:
     - Stripe `tax_rate_id`
     - Snapshot fields: name, percentage, inclusive/exclusive

5. **Alignment & Review**
   - Review existing implementation and adjust to match this specification.

## Non-Functional Requirements

- Maintain end-to-end type safety (Effect Schema for server input/output, Drizzle-derived types).
- Use Angular standalone components, modern control flow, and typed non-nullable forms.
- UI follows Material Design 3 + Tailwind theme tokens.
- Respect SSR constraints; no client-only APIs without guards.

## Acceptance Criteria

- Admin user with `admin:tax` can access a read-only tax-rate list under `admin/` routes.
- Sync occurs only when an authorized user explicitly triggers it, and reflects Stripe data.
- Only inclusive tax rates are available in selection.
- Paid registration options require a tax-rate selection; free options hide the selector.
- Stripe payment creation uses the selected tax rate.
- Registration records include tax_rate_id + snapshot fields.
- Existing implementation is reviewed and aligned to this spec.

## Out of Scope

- Creating or editing tax rates in Evorto.
- Automatic background or scheduled sync.
- Non-inclusive tax rate support.
