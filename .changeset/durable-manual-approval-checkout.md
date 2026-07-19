---
default: patch
---

# Make manual registration approval concurrency-safe

- claim one pending registration payment before reserving capacity or calling Stripe,
- persist an immutable Checkout request so concurrent attempts and crash retries reuse the same transaction and idempotency key,
- expose honest organizer and participant recovery states while a payment link is being prepared,
- serialize cancellation against approval and require exact local transaction/session ownership in Stripe webhooks, and
- document the complete free and paid manual-approval journeys with generated Playwright guidance.
