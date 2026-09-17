---
default: patch
---

Prevent concurrent registration approval, payment completion, add-on purchases, and platform role assignments from deadlocking. Preserve concurrent free sign-ups across events while checking current eligibility and payment settings under a consistent lock order.

Platform role assignments acquire their organization row before membership, matching registration eligibility while retaining the role-graph advisory lock.

Use the current organization limit when admitting a sign-up, after acquiring the existing eligibility locks. A settings change that commits first applies to that admission; a change waiting behind it applies afterwards. Waitlist entries remain exempt from the active-registration limit.
