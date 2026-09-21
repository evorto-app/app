---
default: patch
---

# Keep platform scanner actions tied to confirmed state

Bind platform cancellation to the sign-up and payment state shown in its confirmation dialog. Reject a changed state before cancellation or refund work. Confirm completed cancellation without guessing its former state, and preserve completed approval, cancellation and check-in outcomes when loading current details fails.

Use scoped scanner diagnostics and free-ticket fixtures for scanner flows without Stripe payment sources.
