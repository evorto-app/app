---
default: patch
---

# Improve finance receipt submission, approval, and refunds

- let organizations choose permitted receipt countries and whether other
  countries are allowed,
- reuse clear receipt fields while submitting and approving expenses,
- keep refund lists stable while they update,
- remove the profile-receipts shortcut from the finance overview, and
- update Playwright specs and generated guide coverage for receipt workflows.

Receipt submission, review, and reimbursement retain entered values while the
action and all active follow-up reads finish. A confirmed save followed by a
failed read or navigation keeps its saved outcome visible. Unconfirmed mutation
responses retain a separate message and prevent another write until the user
checks fresh state.

Closing an uncertain receipt submission keeps Add receipt unavailable. Show
latest receipts reads the original event before another editor can open, even
when the page has changed events. Receipt review and ordinary reimbursement
outcomes direct users to reload the page; platform finance provides an explicit
read-only refresh. These changes do not retry a payment or change refund recovery
eligibility.

Leaving a platform receipt page prevents a late detail read from changing the
closed editor or showing its error notification.

Distinguish a missing uploaded receipt from a temporary storage outage. Missing
files are rejected with instructions to add the file again; storage failures
retain cleanup ownership. Receipt approval and reimbursement queues offer a
read-only retry after an initial load failure without repeating a reimbursement.
