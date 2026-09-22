---
default: patch
---

Reject impossible receipt dates, amounts that exceed supported limits,
oversized reimbursement batches, and malformed bank or PayPal payout details
before finance work begins.

Apply the same checks during receipt review and reimbursement. Normalize valid
bank and PayPal details before saving them in a profile, and keep invalid payout
entries available for correction with a field-specific message.
