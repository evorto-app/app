---
default: patch
---

Scope imported Stripe tax rates to their owning Connect account, reject stale
or unowned metadata in payment configuration and Checkout paths, and reject
attaching a different account after the organization has connected one.

The fresh target schema requires account ownership directly. Server writers
serialize paid event and template configuration, tax-rate imports, and account
attachment on the tenant row. Changing a connected account is intentionally
unsupported; there is no tax-rate remapping or compatibility path. Legacy data
transfer must provider-verify every imported rate and write its owning account;
nullable staging rows, production backfills, and runtime-installed integrity
triggers are not part of the release path. The schema-managed tenant/rate
unique index remains the conflict target for account-scoped import upserts.
