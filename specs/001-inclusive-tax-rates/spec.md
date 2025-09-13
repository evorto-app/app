# Feature Specification: Inclusive Tax Rates (Tenant‑Scoped, Tax‑Inclusive Pricing)

**Feature Branch**: `001-inclusive-tax-rates`  
**Created**: 2025-09-13  
**Status**: Draft  
**Input**: User description: "Add an Inclusive Tax Rates feature to the existing multi‑tenant events platform. The goal is to ensure that all paid registration prices shown to participants are final and tax‑inclusive (VAT‑style), while letting each tenant manage their own tax rates and ensuring compliance. Tenant admins can browse their external payment provider’s tax rates, then import selected rates into the tenant’s settings. Only rates that are inclusive and active are considered compatible for use outside the admin area; exclusive or archived rates are visible for context but not selectable by creators. Event creators must select exactly one compatible tax rate for every paid registration option (both in templates and in individual events). When a registration option is free, the tax rate field is disabled and must be empty. Wherever a paid price is displayed, show a clear label such as “Incl. <percentage>% <name>” alongside the price to make the tax‑inclusive policy explicit to users. When a participant registers for a paid option, the payment request must use the displayed price (already tax‑inclusive) and include the selected tax rate identifier for compliance; the app must not add tax on top internally. If discounts apply, they reduce the final price first and the “Incl. …” label remains. All tax rates, selections, and operations are strictly scoped by tenant; no cross‑tenant visibility. If a tenant has not imported any compatible rates, paid options cannot be saved and the UI should explain that a compatible rate must be imported first. If a previously saved paid option references a rate that later becomes unavailable, keep checkout functional and fall back to a neutral “Incl. Tax” label if the detailed label cannot be resolved. For development and demos, prepare a small set of sample rates per tenant (e.g., inclusive active 0%, 7%, and 19%) and a few templates/events that exercise free and paid scenarios (e.g., organizer option at 7% and participant option at 19%). Success looks like: admins can import provider rates and see an “Imported tax rates” list; creators are required to choose a compatible rate for paid options and cannot attach one to free options; participants see unambiguous inclusive pricing; payment requests carry the selected rate identifier; discounts adjust the final inclusive price; and all behavior is correctly tenant‑isolated."

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

- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation

When creating this spec from a user prompt:

1. **Mark all ambiguities**: Use [NEEDS CLARIFICATION: specific question] for any assumption you'd need to make
2. **Don't guess**: If the prompt doesn't specify something (e.g., performance targets) note it
3. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous" checklist item
4. **Common underspecified areas**:
   - User types and permissions
   - Data retention/deletion policies
   - Performance targets and scale
   - Error handling behaviors
   - Integration requirements
   - Security/compliance needs

---

## User Scenarios & Testing _(mandatory)_

### Primary User Story

As a tenant administrator I want to import inclusive tax rates from the external payment provider so that event creators must attach one compatible inclusive tax rate to every paid registration option and participants always see final tax‑inclusive prices that align with compliance expectations.

### Supporting User Stories

1. As an event creator I must select exactly one compatible (inclusive & active) tax rate for each paid registration option so that the displayed price matches what participants pay.
2. As a participant I want every displayed paid price to clearly state it includes tax so I have price certainty before checkout.
3. As a tenant admin I want visibility of incompatible (exclusive or archived) provider rates for context while ensuring they cannot be selected for new paid options.
4. As a tenant admin I want a clear explanation when no compatible rates exist so I understand I must import one before saving paid options.
5. As a participant I expect discounts to reduce the final amount I pay without changing the inclusive tax label format.

### Acceptance Scenarios

1. Given a tenant has imported at least one inclusive active tax rate, When an event creator defines a paid registration option, Then they are required to choose one compatible tax rate before saving.
2. Given a registration option is free (isPaid = false), When the creator edits it, Then the tax rate field is disabled and no rate is stored.
3. Given a participant views an event with paid options, When prices are shown, Then each paid price displays a label "Incl. <percentage>% <name>" directly adjacent to the amount.
4. Given a discount code reduces a paid option's price, When the discounted price is displayed, Then the inclusive tax label still shows the original tax rate information and the amount reflects the discount.
5. Given a previously saved paid option references a tax rate that has since become unavailable (removed, archived, or no longer retrievable), When a participant proceeds to checkout, Then the price is still payable and the label shows "Incl. Tax" fallback.
6. Given a tenant has not imported any compatible rates, When an event creator attempts to save a paid registration option, Then saving is blocked and a message instructs importing an inclusive tax rate first.
7. Given multiple tenants exist, When tenant A imports rates, Then tenant B cannot view or use those rates (strict isolation).
8. Given an imported inclusive active tax rate, When a participant completes payment, Then the payment request uses the displayed tax‑inclusive price without extra tax added and carries the selected tax rate identifier.

### Edge Cases

- No compatible (inclusive & active) rates available from provider: creation of paid options blocked with explanatory message.
- Imported rate later becomes incompatible (e.g., archived): existing paid options continue to function with note in the tenant overview that shows that some options use no longer active tax rates.
- Discount reduces price to zero: clarify if system treats resulting option as free or discounted paid option; label presence needs definition. If the price ever drops <= 0, the option should be considered free, no stripe payment should even be created.
- Zero percent inclusive tax rate (0%): treated as compatible and labeled (e.g., "Incl. 0% VAT"). 0% rates should be allowed, the label should be "Tax free".
- External provider rate percentage changes after import: determine whether automatic sync updates label or requires re‑import. Decision: stripe does not allow rates to change, should that happen anyways, the label should be synced.
- Tenant deletes or deactivates an imported rate that is in use: required behavior for existing options besides fallback label. Admins can remove rates, events that still use these rates would show up in the tenant warning list.
- Multi‑currency events (if supported): handling of same percentage across currencies. Not supported.
- Simultaneous edits by two creators selecting rates: concurrency policy unspecified. The last write should win.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST allow a tenant administrator to view the external payment provider's tax rates list filtered to that tenant's provider account.
- **FR-002**: System MUST allow the tenant administrator to import one or more selected tax rates that are inclusive & active at time of import.
- **FR-003**: System MUST store imported tax rates scoped strictly to the originating tenant (no cross‑tenant access).
- **FR-004**: System MUST visibly distinguish compatible rates (inclusive & active) from incompatible ones (exclusive or archived) in the admin interface.
- **FR-005**: System MUST prevent event creators from selecting incompatible rates when configuring paid registration options.
- **FR-006**: System MUST present an "Imported tax rates" list showing each imported rate's name, percentage, inclusion type (implicit: inclusive), and status. Additional columns may be added for future use.
- **FR-007**: System SHOULD allow viewing incompatible (exclusive/archived) provider rates for context but not importing them as compatible. No imports for historical reference are allowed.
- **FR-008**: System MUST require exactly one compatible tax rate selection when saving any paid registration option in a template or event.
- **FR-009**: System MUST disable and clear the tax rate field whenever the registration option price is zero (free) and reject any attempt to associate a rate.
- **FR-010**: System MUST block saving a paid registration option if the tenant has zero imported compatible rates and display guidance to import one first.
- **FR-011**: System MUST display for every paid price the label format: "Incl. <percentage>% <name>" adjacent to the amount (presentation consistent across listings, detail pages, carts, checkout, confirmations, invoices/receipts if any). It is sufficient to show this to the association members in the template details, users generally don't care as they see the final price and the payment provider shows the tax rate during checkout.
- **FR-012**: System MUST send payment requests using the exact user‑visible tax‑inclusive price (no additional tax added internally) plus the selected tax rate identifier for compliance purposes. No exact format is needed, just the price and the identifier.
- **FR-013**: System MUST keep checkout functional if a previously referenced tax rate becomes unavailable, it should still attach the tax rate id and continue to display the inclusive tax label. If the tax rate is not available at the payment provider, the checkout process should fail.
- **FR-014**: System MUST apply any discount to the final inclusive price (reducing the amount charged) while retaining the original tax label using the same percentage and name.
- **FR-015**: System MUST retain the association between a completed registration (and any payment record) and the tax rate identifier originally selected.
- **FR-016**: System SHOULD provide a development/demo seed of sample inclusive active tax rates (e.g., 0%, 7%, 19%) per tenant. Sample data is not relevant for production use.
- **FR-017**: System MUST allow participant experience to remain unambiguous even if the detailed percentage cannot be resolved by showing generic label "Incl. Tax".
- **FR-018**: System MUST ensure incompatible rates cannot be accidentally applied via bulk editing or cloning flows.
- **FR-019**: System MUST enforce tenant isolation for all tax rate listing, importing, labeling, and selection operations.
- **FR-021**: System SHOULD notify administrators if an in‑use imported rate becomes unavailable/incompatible. This can happen in the tenant wide warnings area.
- **FR-022**: System MUST support zero‑percent inclusive tax rates for use cases where tax applies at 0%. System should not care, as tax rates are inclusive anyways and just shown by the payment provider.
- **FR-023**: System SHOULD log (at a business/audit level) the import of tax rates and their later unavailability for compliance traceability. Audit log retention will be determined by the business.

### Non‑Functional / Policy Requirements (Derived)

- **NFR-001**: User interface text must clearly communicate inclusive pricing to reduce support queries. The taxes are only shown by the payment provider during checkout. For simplicity the platform only shows the price.
- **NFR-002**: Tenant isolation must prevent enumeration of other tenant tax rates (confidentiality). (Exact security mechanisms out of scope in this spec.)
- **NFR-003**: All requirements must be testable via end‑to‑end scenarios including seed data for demo tenants.
- **NFR-004**: Accessibility of tax labels (screen reader clarity) should be preserved. Not a focus at the moment
- **NFR-005**: Performance targets for loading tax rate lists not specified. Not a focus at the moment. All queries should not exceed 200ms.

### Ambiguity & Clarification Log

All [NEEDS CLARIFICATION] markers above summarize open questions requiring stakeholder input before acceptance.

### Key Entities _(feature involves data)_

- **Tenant**: Isolated logical customer scope owning imported tax rates, events, templates, discounts.
- **Tax Rate (Imported)**: A snapshot of an external provider's inclusive active tax rate at time of import; attributes: identifier (provider reference), name/label, percentage, status (active, inactive/unavailable), inclusion type (always inclusive for compatibility), import timestamp. No cross‑tenant sharing.
- **Provider Tax Rate (External Listing)**: Read‑only representation of available rates from provider used during import; may include inclusive, exclusive, active, archived statuses.
- **Event Template**: Blueprint containing registration option definitions requiring compatible rate selection for each paid option.
- **Event**: Instance derived from template or standalone; contains registration options referencing imported tax rates.
- **Registration Option**: Defines price (zero or >0), required tax rate (if paid), discount applicability.
- **Discount**: Mechanism reducing the final payable amount of a registration option; applied to inclusive price.
- **Payment Request**: Outbound transaction context including final price (already tax‑inclusive) and tax rate identifier for compliance.
- **Audit Record (optional)**: Captures actions like tax rate import, deactivation, unavailability. Audit logs are needed, but not a focus of the current spec.

---

## Review & Acceptance Checklist

_GATE: Automated checks run during main() execution_

### Content Quality

- [ ] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous (except where explicitly flagged)
- [ ] Success criteria are measurable (quantitative performance metrics missing)
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified (pending clarifications)

### Testability & Validation Surface

- [x] Primary user journey can be validated via E2E tests
- [x] Non‑functional constraints (auth/roles, a11y placeholders) stated at high level
- [x] Documentation test journey feasible (labels, selection rules)

### Legacy Data Migration (if applicable)

- [ ] Data mapping rules (not fully defined for pre‑existing paid options without tax rate) [NEEDS CLARIFICATION: Are there legacy options lacking tax rate needing backfill?]
- [ ] Defaults/backfills for new fields identified (pending decision on legacy data)
- [x] Required seed data updates listed (sample 0%, 7%, 19% rates)
- [ ] Migration work constraints (depends on legacy presence)

---

## Execution Status

_Updated by main() during processing_

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [ ] Review checklist passed (clarifications outstanding)

---

_Based on Constitution 1.0.0 - See `/memory/constitution.md`_

---
