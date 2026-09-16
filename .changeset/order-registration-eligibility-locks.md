---
default: patch
---

Prevent concurrent registration approval, payment completion, add-on purchases, and platform role assignments from deadlocking. Preserve concurrent free sign-ups across events while checking current eligibility and payment settings under a consistent lock order.
