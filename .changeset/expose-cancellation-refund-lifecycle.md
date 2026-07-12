---
evorto: patch
---

# Expose cancellation refund progress and recovery

Show participant-safe refund progress on cancelled Profile event cards and
operator-safe lifecycle summaries in platform finance, distinguish queued,
provider-action, stopped, and recovered states consistently, fail closed before
a paid add-on cancellation can mutate inventory without a reconciled payment
allocation, and document the signed Stripe failure and audited recovery journey.
