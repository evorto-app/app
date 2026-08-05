---
default: patch
---

# Validate profile contact and payout details

- canonicalize communication and PayPal email addresses before persistence,
- normalize IBANs to electronic format and validate their country, length, and
  MOD-97 checksum,
- reject malformed stored profile details at RPC output boundaries, and
- enforce canonical email and IBAN shapes in the fresh database schema.
