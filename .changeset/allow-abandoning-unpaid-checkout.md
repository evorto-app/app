---
default: patch
---

# Allow unpaid sign-ups to be cancelled after the ticket deadline

Keep Cancel sign-up available while initial payment is pending. Close the Stripe checkout before cancelling the reservation and releasing places, while preserving confirmed-ticket deadlines and payment-state race protection.
