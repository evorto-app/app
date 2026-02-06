# Implementation Plan

## Phase 1: Discovery + Data Design

- [x] Task: Audit existing finance, event, and transaction flows
  - [x] Identify current receipt/expense concepts (if any)
  - [x] Identify transaction schema and linking patterns
  - [x] Identify permission system usage for finance actions
- [x] Task: Design receipt/refund data model changes [05bb914]
  - [x] Define receipt status lifecycle and required fields
  - [x] Define links between receipts, events, users, and transactions
  - [x] Define R2 original storage + Cloudflare Images preview metadata
- [x] Task: Plan E2E/doc coverage for new receipt flows
  - [x] Identify user journeys for submit/approve/refund
  - [x] Identify doc tests/screenshots needed
- [ ] Task: Conductor - User Manual Verification 'Discovery + Data Design' (Protocol in workflow.md)

## Phase 2: Receipt Submission (Backend + UI)

- [x] Task: Implement database schema changes for receipts
  - [x] Add receipt tables/columns and relations
  - [x] Add status + audit fields
  - [x] Enforce single attachment per receipt
- [x] Task: Implement API for receipt submission and retrieval [05bb914]
  - [x] Add Effect Schema inputs/outputs
  - [x] Add permission checks for submission
  - [x] Accept image or PDF attachment and store preview reference
- [x] Task: Event organization UI - receipt list + add receipt flow [05bb914]
  - [x] Add receipt list to existing event organization screen
  - [x] Add receipt submission form with required fields
  - [x] Integrate R2 upload + Cloudflare Images preview generation
- [x] Task: Profile UI - receipts list and section-based profile
  - [x] Convert profile to section-based layout
  - [x] Add "Receipts" section with status list
- [x] Task: Add/extend e2e + doc tests for submission + profile
  - [x] Cover submission flow from event organization
  - [x] Cover receipt list in profile
- [ ] Task: Conductor - User Manual Verification 'Receipt Submission (Backend + UI)' (Protocol in workflow.md)

## Phase 3: Approval Flow

- [x] Task: Implement API for approval/rejection
  - [x] Add status transition logic
  - [x] Add permission checks for `receipt.approve`
- [x] Task: Finance UI - unapproved receipts list (grouped by event)
  - [x] Implement list view with grouping + filters
- [x] Task: Finance UI - approval detail view
  - [x] Left: receipt image
  - [x] Right: editable receipt fields
  - [x] Approve/reject actions
- [x] Task: Add/extend e2e + doc tests for approval
  - [x] Cover approval list and detail workflow
- [ ] Task: Conductor - User Manual Verification 'Approval Flow' (Protocol in workflow.md)

## Phase 4: Refund Flow + Transactions

- [x] Task: Implement API for refund initiation
  - [x] Enforce approved-only selection
  - [x] Allow multi-event receipts per recipient within tenant
  - [x] Pull payout details (IBAN/PayPal) from profile
- [x] Task: Create transaction records on refund
  - [x] Link to recipient and related events (or comment)
  - [x] Mark receipts as refunded
- [x] Task: Finance UI - approved receipts list grouped by recipient
  - [x] Multi-select receipts and compute total
  - [x] Show payout details in selection flow
- [x] Task: Add/extend e2e + doc tests for refunds
  - [x] Cover selection + total calculation + refund action
- [ ] Task: Conductor - User Manual Verification 'Refund Flow + Transactions' (Protocol in workflow.md)

## Phase 5: Documentation + Polish

- [x] Task: Update doc tests and generated documentation artifacts
  - [x] Finance flows (submit/approve/refund)
  - [x] Profile receipts view
- [ ] Task: UI/UX polish and accessibility checks
  - [x] M3 alignment and responsive layout
  - [x] Receipt country admin settings (`Allow other`) and tenant validation flow
  - [x] Shared receipt form fields between submission and approval
  - [x] Refund table runtime stabilization (no signal writes during template render)
  - [ ] Reduced-motion handling
- [ ] Task: Conductor - User Manual Verification 'Documentation + Polish' (Protocol in workflow.md)
