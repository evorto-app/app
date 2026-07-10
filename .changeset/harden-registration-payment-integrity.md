---
evorto: patch
---

# Make registration refunds and Stripe ownership durable

- persist each registration payment's owning Stripe Connect account and use it for Checkout retries, expiry reconciliation, fee hydration, and refunds,
- create refund claims atomically with local registration transitions, then reconcile them through idempotent retry workers and Stripe webhooks,
- recover terminal or exhausted refunds on the same source-linked claim with generation-aware idempotency and archived attempt history,
- preserve the immutable gross payment amount while storing Stripe application fee, processing fee, and net amount separately,
- enforce participant cancellation deadlines and choose gross-versus-net refunds from the locked tenant and registration-option policy,
- finalize transfer Checkouts and transfer refunds through transfer-specific atomic paths instead of generic capacity cleanup,
- lease and reconcile bound Checkouts through their persisted Connect account, recovering missed paid completion for direct, manual, and transfer registrations only after exact gross-amount and currency validation,
- route delayed-payment success through the same idempotent completion transition and preserve only Stripe-confirmed retryable failures, and
- keep Checkout expirations safely inside Stripe's minimum and maximum creation windows, and
- block connected-account changes while registration Checkouts or refunds remain pending.
