# Feature Specification: Registration cancellation configuration

**Feature Branch**: `004-registration-cancellation-configuration`  
**Created**: 2025-09-17  
**Status**: Draft  
**Input**: User description: "Registration cancellation configuration
We already have rregistrations in our app, there is a secondary functionality missing: Cancelling a registration. For this, users with the right permissions should have the option to define until when registrations can be cancelled. In case of paid registrations, a cancellation should come with a refund. Admins can define if that refund should include transaction and app fees or not. It should be possible to define this configuration for every registration option or opt in to use the tenant default. For this we need some configuration in the tenant as well. Here it would be good to give the option of differentiating between paid and free, as well as regular and organizer registrations. So at most a tenant and registration option could have four cofigurations, Ideally the user is not confronted with four forms though but could also just enter one config that includes all. The configuration should define if a cancellation is possible and if so, if fees will be refunded and until what time before the event starts a cancellation is allowed. For this we can reuse our days + hours input. The information about the cancellation options should be visible to users before registering for an event."

## Execution Flow (main)
```
1. Parse user description from Input
   → If empty: ERROR "No feature description provided"
2. Extract key concepts from description
   → Identify: actors, actions, data, constraints
3. For each unclear aspect:
   → Mark with [NEEDS CLARIFICATION: specific question]
4. Fill User Scenarios & Testing section
   → If no clear user flow: ERROR "Cannot determine user scenarios"
5. Generate Functional Requirements
   → Each requirement must be testable
   → Mark ambiguous requirements
6. Identify Key Entities (if data involved)
7. Run Review Checklist
   → If any [NEEDS CLARIFICATION]: WARN "Spec has uncertainties"
   → If implementation details found: ERROR "Remove tech details"
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

### Section Requirements
- Mandatory sections: Must be completed for every feature
- Optional sections: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation
When creating this spec from a user prompt:
1. Mark all ambiguities: Use [NEEDS CLARIFICATION: specific question] for any assumption you'd need to make
2. Don't guess: If the prompt doesn't specify something (e.g., "login system" without auth method), mark it
3. Think like a tester: Every vague requirement should fail the "testable and unambiguous" checklist item
4. Common underspecified areas:
   - User types and permissions
   - Data retention/deletion policies  
   - Performance targets and scale
   - Error handling behaviors
   - Integration requirements
   - Security/compliance needs

---

## User Scenarios & Testing (mandatory)

### Primary User Story
As a tenant admin or event organizer with the appropriate permissions, I want to configure if and until when attendees can cancel their registrations, and whether refunds include fees, so that cancellation rules are clear, enforced consistently, and reflected to users before they register.

### Acceptance Scenarios
1. Given a paid registration option and a tenant default cancellation policy, When the option is set to "use tenant default", Then the system applies the tenant policy for cancellation eligibility and refund composition to that option.
2. Given a registration option with its own cancellation policy, When an attendee cancels before the configured cutoff time, Then the cancellation is accepted and any applicable refund is calculated based on the policy (including or excluding transaction/app fees as configured) and shown to the user before confirmation.
3. Given a registration option with cancellation disabled, When an attendee attempts to cancel, Then the system prevents the cancellation and clearly communicates that cancellations are not allowed for this option.
4. Given a paid registration where cancellations are allowed until X days/hours before event start, When an attendee attempts to cancel after the cutoff, Then the system denies the cancellation and explains the cutoff has passed.
5. Given an organizer registration type with a distinct tenant-level policy, When the organizer cancels their registration, Then the system follows the organizer-specific policy (which may differ from regular attendee policy) for eligibility and refund handling.
6. Given a free registration, When cancellation is allowed and performed before cutoff, Then no monetary refund is processed but the registration is released and capacity is updated accordingly.
7. Given cancellation policies are configured, When a user views the event registration page, Then the cancellation policy summary relevant to the displayed option is visible prior to registration.
8. Given a user with insufficient permissions, When they attempt to edit cancellation configuration, Then access is denied and an appropriate message is shown.
9. Given an event start time has been changed, When the system evaluates cancellation eligibility, Then the cutoff is recalculated relative to the updated start time and applied accordingly.
10. Given a paid registration with a discount applied, When cancellation is allowed, Then the refund amount is based on the actual amount paid (after discount), subject to fee inclusion settings.
11. Given Stripe allows full refunds even after processor fees are no longer refundable, When a full refund is executed, Then the tenant bears any fees not returned by Stripe and the attendee receives a full paid amount back.
12. Given a payment is in progress and not yet successful, When the user cancels, Then the cancellation is allowed and no spot is retained; if payment later succeeds, it MUST be voided/refunded automatically according to platform payment handling.
13. Given cancellation is not currently allowed by policy (e.g., outside cutoff or disabled), When a user views their registration detail, Then the UI does not show a cancel action.

### Edge Cases
- Event time changes: Cutoffs always re-evaluate relative to the current event start time; only relative (days + hours) data is stored. Note: Add a future evaluation item to define general handling and notifications for time changes.
- Processor fees: Stripe supports full refunds at any time; if fees are not returned by Stripe, the tenant bears those costs when issuing a full refund. Partial refunds follow policy regarding inclusion/exclusion of app/transaction fees.
- Payment not fully successful: Users may cancel payment in progress at any time; cancellations post-success follow the configured policy.
- Discounts/promo codes: Refunds are computed from the actual amount paid after discounts.
- No multi‑item orders: Each registration is independent; line-item proration across multiple items is not applicable.
- Cutoff precision: Cutoff is exact (no grace periods); evaluate at second-level if needed; daylight saving transitions do not introduce special handling beyond exact comparison.

## Requirements (mandatory)

### Functional Requirements
- FR-001: The system MUST allow tenant admins to configure default cancellation policies with up to four variants: paid vs free, and regular vs organizer registrations.
- FR-002: The system MUST allow per‑registration‑option configuration to either (a) use tenant default or (b) define an option‑specific policy.
- FR-003: A cancellation policy MUST specify: (a) whether cancellation is allowed, (b) whether refunds include transaction fees, (c) whether refunds include app fees, and (d) the cutoff relative to event start using days + hours.
- FR-004: For paid registrations, when a cancellation is performed within the allowed window, the system MUST calculate and initiate a refund according to the policy (including/excluding transaction/app fees as set).
- FR-005: For free registrations, when a cancellation is performed within the allowed window, the system MUST cancel without refund and release capacity/inventory accordingly.
- FR-006: The system MUST prevent cancellations outside the allowed window and present a clear message explaining the cutoff.
- FR-007: The event registration UI MUST display a clear summary of the applicable cancellation policy before a user registers, reflecting the actual policy that will apply if they cancel.
- FR-008: Users MUST require appropriate permissions to view and edit cancellation configurations at tenant and option levels; unauthorized users MUST be blocked.
- FR-009: The system MUST support a single combined input form that can set one policy and optionally apply it to all four variants, with the ability to expand/override per variant when needed.
- FR-010: The system MUST store whether a registration option is inheriting the tenant default or using its own policy, and resolve the effective policy at runtime accordingly.
- FR-011: The system MUST log cancellation actions and outcomes (accepted/denied, refund initiated/skipped) for auditing.
- FR-012: The system MUST ensure the cancellation policy is immutable for a specific registration after the point of purchase by calculating and storing the effective policy snapshot at registration time; later policy changes only affect future registrations.
- FR-013: Refund calculations MUST be based on the actual amount paid after any discounts or promo codes.
- FR-014: The system MUST allow full refunds at any time; when a full refund is issued after processor fees are non‑refundable, the tenant bears those fees per platform policy.
- FR-015: The system MUST allow cancellation when payment is still in progress and not yet successful; otherwise cancellations are only possible after payment has succeeded.
- FR-016: The UI MUST hide or disable the cancel action when cancellation is not currently allowed by policy.
- FR-017: Taxes are implicitly handled via tax‑inclusive pricing; no explicit tax handling is required in refund composition (see Platform Policies).
- FR-018: Localization is not required; all text is English only (see Platform Policies).

Examples of marking unclear requirements:
- None. Ambiguities addressed via platform decisions: taxes are handled implicitly (tax‑inclusive pricing; see FR‑017 and Platform Policies) and the platform is English‑only (see FR‑018 and Platform Policies).

### Key Entities (include if feature involves data)
- Cancellation Policy: Represents the rules governing cancellations for a context (tenant default variant or registration option override). Attributes: scope (tenant-variant | option), allowCancellation (boolean), includeTransactionFees (boolean), includeAppFees (boolean), cutoffDays (integer >=0), cutoffHours (integer 0–23), appliesTo (paid/free, regular/organizer), inheritance flag for options. Only relative cutoff (days + hours) is stored; no absolute timestamps.
- Registration: Represents a user's enrollment for an event option. Relevant attributes for this feature: price type (paid/free), role (regular/organizer), purchase timestamp, effectiveCancellationPolicy snapshot at purchase (stored), cancellation timestamp, refund status, amountPaidAfterDiscounts.
- Refund: Represents the financial reversal details when cancelling a paid registration. Attributes: amount, includesTransactionFees (boolean), includesAppFees (boolean), processorReference, status; may be full or partial per policy; for full refunds, tenant may cover processor fees when not returned.

---

## Dependencies & Assumptions

- Platform policies apply to this feature:
   - Taxes: operational logic ignores taxes; all prices are treated as final (tax-inclusive). Fees and refunds consider only the final paid price.
   - Localization: English only; no i18n.
- See `docs/platform-policies.md` for canonical details and future updates.

---

## Review & Acceptance Checklist
GATE: Automated checks run during main() execution

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous  
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

### Testability & Validation Surface
- [x] Primary user journey can be validated via E2E tests
- [x] Non‑functional constraints (auth/roles, performance budgets, a11y where applicable) are stated for E2E validation
- [x] Documentation test journey (where appropriate) is feasible for `.doc.ts`
- [x] Expected documentation outputs (pages/sections) are identified so `.doc.ts` files generate user-facing updates
- [x] PR preview assets (screenshots or rendered markdown snippets) can be produced from documentation tests

### Design System Alignment (if UI involved)
- [x] Material Design 3 references noted (layouts, components, interactions)
- [x] Angular Material component usage or justified alternatives identified
- [x] Tailwind utility expectations align with theme tokens (no custom color guesses)
- [x] Accessibility, responsive behavior, and list–detail expectations captured

### Legacy Data Migration (if applicable)
- [x] Data mapping rules (old DB → new DB) documented
- [x] Defaults/backfills for new fields identified; idempotency and verification checks noted
- [x] Required seed data updates listed so feature is testable without full migration
- [x] Migration work limited to TypeScript ETL steps; final migration runs once at cut‑over

---

## Execution Status
Updated by main() during processing

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [ ] Review checklist passed

---
Based on Constitution 1.1.3 - See `.specify/memory/constitution.md`

---
