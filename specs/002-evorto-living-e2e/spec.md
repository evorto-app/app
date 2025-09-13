# Feature Specification: Evorto Living E2E Baseline

**Feature Branch**: `002-evorto-living-e2e`  
**Created**: 2025-09-13  
**Status**: Ready for Planning  
**Input**: User description: "Create “Evorto Living E2E Baseline,” a foundation of end‑to‑end tests that both verify the core user journeys ... (full prompt captured internally)"

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
6. Identify Key Entities (data involved)
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
1. **Mark all ambiguities**: Use [NEEDS CLARIFICATION: specific question]
2. **Don't guess** beyond what prompt supports
3. **Think like a tester**: Each requirement must be observable in UI or measurable outcome
4. Common underspecified areas flagged below where relevant

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
Platform stakeholders need a living, trustworthy baseline of core user journeys that simultaneously (a) validates critical multi‑tenant event lifecycle behaviors and (b) produces human‑readable narrative documentation that always reflects real, current product behavior. This baseline reduces regression risk, accelerates onboarding, and creates an authoritative source of truth for how roles, event creation, visibility, and registration flows work. Finance, tax, and discount functionality are explicitly out of scope for this initial baseline.

### Journeys (Living Documentation `.doc` Flows)
Each journey produces: narrative steps (user value framing), assertions of visible outcomes, and selective screenshots illustrating key states.
1. Create your account (first‑time unauthenticated visitor → account creation / first login → onboarding → profile confirmation)
2. Manage templates (authenticated organizer/admin: create a template, explain general + registration settings, save, re-open to verify persistence)
3. Manage template categories (admin: create category, edit existing category, verify listing order/presence)
4. Create and manage events (organizer/admin: create event from template, ensure visibility, correct scheduling, capacity, and pricing attributes)
5. Register for an event – free path (regular user: locate upcoming free event, register, see confirmation & participation state)
6. Register for an event – paid path (regular user: locate upcoming paid event, initiate registration, see pending transaction, complete simulated payment, see confirmed state)
7. Admin: manage roles (admin: create a role, configure permission flags, assign to a user, verify gated access appears)
8. Unlisted events: admin vs user (admin can view/manage unlisted; regular user cannot discover them via listings; direct link access is allowed for anyone with the URL)
9. Scanning (authorized role accesses check‑in / scanning interface; sees event attendance context & status transitions for a registration)
### Acceptance Scenarios (Representative; each journey will enumerate Given/When/Then in test assets)
1. Given a fresh tenant seed, when baseline data seeding runs, then there exist: template categories (>=2), at least one free template, one paid template, upcoming free event (open registration), upcoming paid event (open registration), and at least one past (finished) event.
2. Given a first‑time visitor, when they create an account and complete onboarding, then their profile is initialized and accessible upon next sign‑in without additional setup.
3. Given an organizer, when they create a new template and configure registration settings, then it appears in the template list and retains all entered metadata on re-open.
4. Given admin rights, when a new template category is created and renamed, then the category list reflects both creation and update without duplicates.
5. Given an organizer, when they create an event from a paid template, then the event inherits pricing, is scheduled in the future, and appears to eligible users subject to visibility rules.
6. Given a regular user and an upcoming free event, when they register, then a confirmation state (no payment) is displayed and capacity usage updates.
7. Given a regular user and an upcoming paid event, when they register, then they see a pending transaction amount and after simulated payment a confirmed registration.
8. Given admin role management, when a new role is defined with selected permissions and assigned to a user, then that user gains access only to the newly permitted sections.
9. Given permission override configuration for a test run, when specific permissions are applied to a role/user, then only those granted capabilities become accessible during that run (others remain gated).
10. Given an unlisted event, when accessed via direct link by any authenticated user, then the event details are shown; when browsing listings without the link, regular users do not see it.
11. Given scanning permissions, when the scanning UI loads for an event, then registrations can be searched/scanned and status indicators are clear.
12. Given past events exist, when a user views event listings, then past events are excluded from the default upcoming list while remaining accessible via management interfaces for authorized roles.

### Edge Cases
- Registration window boundary: event becomes open exactly at seeded start – ensure open/closed handling at boundary.
- Capacity full after last free registration – ensure further registration attempt blocks and communicates reason.
- Direct link access to unlisted event is allowed: ensure no listing exposure but direct navigation succeeds.
- Role deletion while assigned – all currently assigned users immediately lose associated permissions; related gated areas become inaccessible on next authorization check.
- Time zone handling – tests run using the system (tenant) timezone; all seeded event times relative to that timezone.

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: Provide a per-run isolated tenant so test outcomes are deterministic.
- **FR-002**: Seed baseline data: categories (>=2), free template, paid template, upcoming free event (open registration), upcoming paid event (open registration), at least one past (finished) event.
- **FR-003**: Ensure seeded events' start/end times are relative to current time so they remain “upcoming” during execution (except the explicit past event).
- **FR-004**: Allow creation of a new user account via first-time journey without pre-existing credentials.
- **FR-005**: Record onboarding completion enabling immediate profile access thereafter.
- **FR-006**: Allow authorized roles to create templates with configurable general and registration settings.
- **FR-007**: Persist all template fields so reopening shows previously entered data.
- **FR-008**: Allow Admin to create template categories.
- **FR-009**: Allow Admin to edit existing template category names.
- **FR-010**: Reflect new & updated categories in the category listing without duplicates.
- **FR-011**: Allow event creation from an existing template.
- **FR-012**: Inherit relevant template defaults (title elements, pricing mode, registration settings) into event.
- **FR-013**: Display events in listings per visibility rules (listed vs unlisted distinction).
- **FR-014**: Allow registration to a free event without payment steps.
- **FR-015**: Confirm successful free registration with a visible success state.
- **FR-016**: Allow registration to a paid event producing a pending transaction state.
- **FR-017**: Transition a paid registration from pending to confirmed upon simulated successful payment.
- **FR-018**: Provide Admin ability to create a role with permission flags and allow test configuration to override/inject specific permissions per run.
- **FR-019**: Allow assigning the newly created role to a user; permissions take effect on next authorized navigation.
- **FR-020**: Restrict gated areas until user possesses required permissions.
- **FR-021**: Hide unlisted events from standard user discovery lists when user lacks privileges.
- **FR-022**: Allow direct link access to unlisted events for any authenticated user (bypasses listing discovery restriction).
- **FR-023**: Allow Admin to access/manage unlisted events directly.
- **FR-024**: Provide scanning/check-in UI to authorized roles.
- **FR-025**: Allow scanning/lookup of a registration and reflect attendance state.
- **FR-026**: Generate living documentation artifacts (narratives + screenshots) from successful journey executions.
- **FR-027**: Ensure each documentation journey states user value (“why”) alongside asserted outcomes.
- **FR-028**: Keep selectors or identifiers human-readable (role-/label-based) for resilience.
- **FR-029**: Avoid cross-tenant data leakage; one run's tenant data must not influence another run.
- **FR-030**: Allow deterministic re-seeding from a clean state.
- **FR-031**: Express all assertions in terms of visible UI state (pages, labels, buttons, confirmations, monetary values).
- **FR-032**: Represent payment “pending” state distinctly from “confirmed”.
- **FR-033**: Ensure time-based event eligibility adjusts relative to current execution time.
- **FR-034**: Provide stable ordering of seeded objects where ordering matters (e.g., categories list deterministic).
- **FR-035**: Keep journeys extensible so new features add a paired documentation + minimal regression test.
- **FR-036**: Overwrite prior documentation artifacts in a single canonical folder and place screenshots for a journey in a single folder named after that journey.
- **FR-037**: Use system (tenant) timezone; all seeded times align so assertions are stable.
- **FR-038**: Seed at least one past (completed) event for visibility/historical assertions.
- **FR-039**: Allow test harness to set or override specific permissions per run.
- **FR-040**: Produce documentation markdown with ONLY a front matter `title` and optional permissions callout block.
- **FR-041**: Render permission callout exactly with required structure (title, bullet list of permissions).
- **FR-042**: Treat screenshot filenames as opaque provided references resolve within the journey folder.


### Key Entities
- **Tenant**: Logical isolation boundary for seeded test data and operations.
- **User**: Actor with authentication identity and associated role(s); includes unauthenticated visitor state.
- **Role**: Named permission bundle controlling access to administrative / scanning capabilities.
- **Permission Configuration (Test Harness)**: Run-scoped override of permissions applied to roles/users to validate gating scenarios.
- **Template Category**: Organizational grouping label for templates.
- **Template**: Reusable blueprint for creating events (metadata & registration defaults).
- **Event**: Scheduled instance created from a template; has visibility (listed/unlisted), pricing flag (free or paid), registration window; may be upcoming or past.
- **Registration**: User’s enrollment record for an event (free or paid) with state (pending, confirmed, potentially future states like canceled / attended).
- **Documentation Artifact**: Narrative + screenshot bundle (overwrites canonical artifacts) containing ONLY a `title` front matter field and optional permissions callout; screenshots live in a single folder per journey with arbitrary filenames referenced in markdown.
- **Scanning Record (Attendance State)**: Association marking presence / check-in outcome for a registration.
---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [ ] No implementation details (languages, frameworks, APIs)
- [ ] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [ ] All mandatory sections completed

### Requirement Completeness
- [ ] No [NEEDS CLARIFICATION] markers remain
- [ ] Requirements are testable and unambiguous  
- [ ] Success criteria are measurable
- [ ] Scope is clearly bounded
- [ ] Dependencies and assumptions identified

### Testability & Validation Surface
- [ ] Primary user journey can be validated via E2E tests
- [ ] Non‑functional constraints (auth/roles, performance budgets, a11y where applicable) are stated for E2E validation
- [ ] Documentation test journey is feasible for `.doc.ts`

### Legacy Data Migration (if applicable)
- [ ] Data mapping rules (old DB → new DB) documented
- [ ] Defaults/backfills for new fields identified; idempotency and verification checks noted
- [ ] Required seed data updates listed so feature is testable without full migration
- [ ] Migration work limited to TypeScript ETL steps; final migration runs once at cut‑over

---

## Execution Status
*Updated by main() during processing*

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [ ] Review checklist passed

---
*Based on Constitution 1.0.0 - See `/memory/constitution.md`*

---

