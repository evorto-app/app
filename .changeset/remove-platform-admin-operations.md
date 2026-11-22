---
default: patch
---

# Remove duplicate platform operations and manual payment recovery

Remove the platform-only event, template, registration, role, tax-rate, member-role and finance RPCs that duplicated each organization's own pages, together with the global-admin payment support page and its manual checkout restore and refund requeue endpoints. Global administration keeps organization setup, the overview, email delivery and change history. Normal payments, refunds, Stripe webhook processing and automatic reconciliation are unchanged.
