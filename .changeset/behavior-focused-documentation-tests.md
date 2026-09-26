---
default: patch
---

Focus automated verification on application behavior and operational outcomes.
Remove editorial, source-inspection, and duplicate test-inventory checks; enforce
important structural constraints through ESLint. Preserve authored documentation
wording, verify transaction recovery against PostgreSQL, and centralize CI Docker
log collection so database and Stripe credentials stay outside diagnostics.
