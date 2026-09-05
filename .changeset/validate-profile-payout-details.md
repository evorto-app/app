---
default: patch
---

# Validate profile contact and payout details

- Trim and validate contact and payout email addresses before saving.
- Format and verify international bank account numbers using their country,
  length, and check digits.
- Reject malformed saved profile details before they are shown.
- Apply the same rules when a profile is created and when it is edited.
