# Implementation Plan

## Phase 1: Discovery + Data Design

- [ ] Task: Audit existing finance, event, and transaction flows
  - [ ] Identify current receipt/expense concepts (if any)
  - [ ] Identify transaction schema and linking patterns
  - [ ] Identify permission system usage for finance actions
- [ ] Task: Design receipt/refund data model changes
  - [ ] Define receipt status lifecycle and required fields
  - [ ] Define links between receipts, events, users, and transactions
  - [ ] Define R2 original storage + Cloudflare Images preview metadata
- [ ] Task: Plan E2E/doc coverage for new receipt flows
  - [ ] Identify user journeys for submit/approve/refund
  - [ ] Identify doc tests/screenshots needed
- [ ] Task: Conductor - User Manual Verification 'Discovery + Data Design' (Protocol in workflow.md)

## Phase 2: Receipt Submission (Backend + UI)

- [ ] Task: Implement database schema changes for receipts
  - [ ] Add receipt tables/columns and relations
  - [ ] Add status + audit fields
  - [ ] Enforce single attachment per receipt
- [ ] Task: Implement API for receipt submission and retrieval
  - [ ] Add Effect Schema inputs/outputs
  - [ ] Add permission checks for submission
  - [ ] Accept image or PDF attachment and store preview reference
- [ ] Task: Event organization UI - receipt list + add receipt flow
  - [ ] Add receipt list to existing event organization screen
  - [ ] Add receipt submission form with required fields
  - [ ] Integrate R2 upload + Cloudflare Images preview generation
- [ ] Task: Profile UI - receipts list and multi-tab profile
  - [ ] Convert profile to multi-tab layout
  - [ ] Add "Receipts" tab with status list
- [ ] Task: Add/extend e2e + doc tests for submission + profile
  - [ ] Cover submission flow from event organization
  - [ ] Cover receipt list in profile
- [ ] Task: Conductor - User Manual Verification 'Receipt Submission (Backend + UI)' (Protocol in workflow.md)

## Phase 3: Approval Flow

- [ ] Task: Implement API for approval/rejection
  - [ ] Add status transition logic
  - [ ] Add permission checks for `receipt.approve`
- [ ] Task: Finance UI - unapproved receipts list (grouped by event)
  - [ ] Implement list view with grouping + filters
- [ ] Task: Finance UI - approval detail view
  - [ ] Left: receipt image
  - [ ] Right: editable receipt fields
  - [ ] Approve/reject actions
- [ ] Task: Add/extend e2e + doc tests for approval
  - [ ] Cover approval list and detail workflow
- [ ] Task: Conductor - User Manual Verification 'Approval Flow' (Protocol in workflow.md)

## Phase 4: Refund Flow + Transactions

- [ ] Task: Implement API for refund initiation
  - [ ] Enforce approved-only selection
  - [ ] Allow multi-event receipts per recipient within tenant
  - [ ] Pull payout details (IBAN/PayPal) from profile
- [ ] Task: Create transaction records on refund
  - [ ] Link to recipient and related events (or comment)
  - [ ] Mark receipts as refunded
- [ ] Task: Finance UI - approved receipts list grouped by recipient
  - [ ] Multi-select receipts and compute total
  - [ ] Show payout details in selection flow
- [ ] Task: Add/extend e2e + doc tests for refunds
  - [ ] Cover selection + total calculation + refund action
- [ ] Task: Conductor - User Manual Verification 'Refund Flow + Transactions' (Protocol in workflow.md)

## Phase 5: Documentation + Polish

- [ ] Task: Update doc tests and generated documentation artifacts
  - [ ] Finance flows (submit/approve/refund)
  - [ ] Profile receipts view
- [ ] Task: UI/UX polish and accessibility checks
  - [ ] M3 alignment and responsive layout
  - [ ] Reduced-motion handling
- [ ] Task: Conductor - User Manual Verification 'Documentation + Polish' (Protocol in workflow.md)
