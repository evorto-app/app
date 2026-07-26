---
default: patch
---

Remove an unused authentication service, tax-rate logging/formatting helpers,
icon-color experiment, Stripe listener shortcut, and direct dependencies with
no production or tooling caller. Surface missing paid-price tax metadata instead
of displaying a plausible inclusive-tax fallback, and update operating-system
packages only through pinned base-image revisions.
