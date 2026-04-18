---
evorto: patch
---

# Polish finance receipts submission, approval, and refund flows

Update the finance receipts experience with:

- tenant-level finance settings for allowed receipt countries plus an `Allow other` toggle,
- shared receipt form fields between submit and approval flows (date picker, tax amount, country select, checkbox-driven amount fields),
- refund list stability fixes to prevent signal writes during template rendering and keep the Material table flow reliable,
- removal of the finance overview shortcut to profile receipts,
- updated Playwright specs and docs coverage for the receipts workflows.
