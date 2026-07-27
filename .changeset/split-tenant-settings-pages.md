---
default: patch
---

# Split tenant settings into focused pages

Replace the monolithic settings form and RPC with five independently saved
sections. Payments and providers now require their own permission while
organization, registration, appearance, and legal settings remain available to
organization settings administrators.

Changed Stripe account IDs are verified before persistence in both tenant and
platform administration. Invalid, unavailable, and concurrently stale account
changes fail visibly instead of deferring the defect to a later payment.
Forms preserve dirty edits across configuration refreshes, confirm before
discarding them during navigation, and pin the originally loaded Stripe account
until the payment settings save completes. Appearance saves wait for brand
asset uploads instead of publishing stale URLs.
