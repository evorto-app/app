---
default: patch
---

Protect recovered Stripe webhook claims from late completion or failure by an older handler. Fenced-out completion or release now reports lost ownership without changing the webhook response.
