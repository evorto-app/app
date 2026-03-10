# Track Spec: Finance Receipts + Refunds

## Overview

Enable event organizers to submit receipt photos and metadata for event expenses, allow authorized users to validate/approve receipts, and process refunds grouped by recipient. Receipts are tenant-scoped and linked to events. Refund issuance creates a financial transaction tied to the recipient and event(s).

## Functional Requirements

- Receipt submission
  - Allow submission for:
    - Users with an organizing registration on the event.
    - Users with `finance:manageReceipts`.
  - Do not allow receipt submission solely via `finance:approveReceipts` or
    `finance:refundReceipts`.
  - Capture required fields per receipt:
    - Receipt attachment (image or PDF).
    - Receipt date.
    - Deposit involved (yes/no) and deposit amount.
    - Alcohol purchased (yes/no) and alcohol amount.
    - Purchase country (tenant-configurable list, with optional "Other").
    - Tax amount.
  - Only one attachment per receipt (submit additional receipts for more files).
  - Link each receipt to its event and submitting user.
- Receipt storage
  - Store receipt files in Cloudflare R2.
  - Use short-lived signed R2 URLs for previews/downloads in finance flows
    (approval/refund/event organize/profile), not public image URLs.
  - Store receipt metadata plus R2 references in the database.
- Event organization UI
  - In the existing event organization screen, show a list of receipts for that event.
  - Provide an action to add a receipt from that screen.
  - Allow assigning a human-readable receipt name at submission time.
- User profile UI
  - Add a list of the user’s submitted receipts and their status in the profile.
  - Convert the profile page to a multi-tab layout (to align with other pages).
- Approval workflow UI
  - Finance section: list unapproved receipts (grouped by event).
  - Approval view layout:
    - Left: receipt image.
    - Right: editable fields for the submitted data.
  - Users with `finance:approveReceipts` can approve or reject.
  - Track receipt status: submitted, approved, rejected.
- Refund workflow UI
  - Finance section: list approved receipts grouped by recipient.
  - Users with `finance:refundReceipts` can select one or more approved receipts for refund.
  - App calculates total refund amount for selected receipts.
  - Only approved receipts can be refunded.
  - Show recipient payout details (IBAN or PayPal) from their profile.
  - Validate requested payout references against recipient profile payout details.
  - Perform refund transaction creation + receipt status updates atomically in one DB transaction.
  - Open receipt previews in an in-app dialog (no navigation redirect).
- Integration and discovery
  - Investigate existing finance/transaction data structures and permissions.
  - Reuse existing transaction flows and schemas where possible, extending them only as needed.

## Non-Functional Requirements

- Tenant isolation for all receipt, approval, and refund operations.
- Maintain strict end-to-end typing across client, server, and database.
- Use Angular standalone components, signals, and modern control flow.

## Acceptance Criteria

- Organizers or users with `finance:manageReceipts` can submit a receipt with an attachment and required fields.
- Receipt attachments can be images or PDFs and are served via signed R2 URLs (no public preview URL requirement).
- Receipts are visible in the event organization screen with an add action.
- Submission supports a user-provided receipt name used in overview/refund lists.
- Users can see their submitted receipts and statuses in their profile.
- Profile is multi-tabbed and includes a receipts tab/section.
- Users with `finance:approveReceipts` can review receipts grouped by event and approve or reject them.
- Approval view shows image left and editable data right.
- Users with `finance:refundReceipts` can select approved receipts grouped by recipient and see the total.
- Refund preview actions open in a dialog.
- Refund issuance validates payout reference against recipient profile and performs all writes atomically.
- All operations are tenant-scoped and permission-gated.

## Out of Scope

- Automatic OCR or auto-validation of receipt photos.
- Multi-currency conversion or tax calculations beyond storing the entered tax rate.
- External payout automation (bank transfer initiation).
