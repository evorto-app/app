---
default: patch
---

# Preserve recorded currency throughout receipt workflows

- record the tenant currency on each new receipt and render review/profile
  amounts from that immutable value,
- keep reimbursement batches currency-homogeneous and create their ledger
  transaction in the receipts' recorded currency,
- serialize receipt review and reimbursement so the ledger always uses the
  locked approved amount, currency, status, and current payout destination,
- prevent tenant and platform-admin currency edits from reinterpreting existing
  template, event, receipt, or transaction amounts without a dedicated migration,
- cover AUD submission and CZK approval and reimbursement in Playwright.
