---
default: patch
---

# Make receipt self-approval a section setting

- Block approvers from approving their own receipts unless the section allows
  self-approval in its receipt settings (off by default).
- Keep recording one's own reimbursement possible, since Evorto only records
  money already sent outside the app.
- Keep the submitted amount when an approver changes a receipt total, flag the
  changed amount in the submitter's receipt list, and show both amounts and the
  approver's name in the receipt details.
