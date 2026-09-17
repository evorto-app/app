---
default: patch
---

Prevent concurrent registration approval, payment completion, add-on purchases, and platform role assignments from deadlocking. Preserve concurrent free sign-ups across events while checking current eligibility and payment settings under a consistent lock order.

Platform role assignments acquire their organization row before membership, matching registration eligibility while retaining the role-graph advisory lock.
