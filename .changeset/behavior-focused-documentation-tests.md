---
default: patch
---

Remove remaining editorial, source-inspection, and duplicate test-inventory
checks while preserving application and operational behavior coverage. Preserve
authored documentation wording, exercise real command/output boundaries, and
centralize CI Docker log collection so database and Stripe credentials stay
outside diagnostics.
