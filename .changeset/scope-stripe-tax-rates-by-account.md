---
default: patch
---

Scope imported Stripe tax rates to their owning Connect account and reject stale
or unowned metadata in payment configuration and Checkout paths. Attach only an
organization's first payment account; an attached account remains immutable.

The fresh target schema requires account ownership directly. Server writers
serialize paid event and template configuration, tax-rate imports, and first
payment-account attachment on the tenant row. Legacy data transfer must provider-verify every
imported rate and write its owning account; nullable staging rows, production
backfills, and runtime-installed integrity triggers are not part of the release
path. The schema-managed tenant/rate unique index remains the conflict target
for account-scoped import upserts.
