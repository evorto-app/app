# Implementation Plan: Registration cancellation configuration


**Branch**: `004-registration-cancellation-configuration` | **Date**: 2025-09-17 | **Spec**: `/Users/hedde/code/duplicates/evorto/specs/004-registration-cancellation-configuration/spec.md`
**Input**: Feature specification from `/Users/hedde/code/duplicates/evorto/specs/004-registration-cancellation-configuration/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
4. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
5. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, or `GEMINI.md` for Gemini CLI).
6. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
7. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
8. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
Allow tenant admins to configure default cancellation policies (up to four variants: paid/free × regular/organizer) and allow each registration option to either inherit the tenant default or define an option‑specific policy. Policies define: whether cancellation is allowed, whether refunds include transaction/app fees, and a cutoff relative to event start (days + hours). Cancellations for paid registrations within the window initiate refunds according to the policy; for free registrations, capacity is released without refunds. The effective policy is snapshotted onto each registration at purchase time (relative values only) and evaluated against the current event start when cancelling. UI follows progressive disclosure: a single combined input with optional per‑variant overrides and option‑level “use tenant default” with a readable summary on registration pages. Minimal data model changes: add JSONB fields for tenant policies and option policies (with an inheritance flag) and a snapshot on registrations; reuse existing transactions for refunds.

## Technical Context
ARGUMENTS (from user): Use existing tRPC/Angular/Node/TypeScript stack, progressive disclosure in UI, minimal but justified data model changes, extend current UI where feasible without over‑complexity, thorough documentation with automated tests, and E2E validation; fit into existing setup.

**Language/Version**: TypeScript (Node.js 20+, Angular 20)
**Primary Dependencies**: Angular Material 3, Tailwind, TanStack Query, tRPC, Effect Schema, Drizzle ORM, Postgres, Playwright
**Storage**: Postgres (Drizzle ORM); JSONB for policy storage; enums for modes
**Testing**: Playwright E2E (+ documentation tests), Jasmine/Karma unit (Angular), server contract tests via tRPC + Effect Schema
**Target Platform**: SSR web app (Angular) + Node server
**Project Type**: web (frontend + backend in single repo)
**Performance Goals**: Cancellation evaluation O(1) per registration; DB ops p95 < 200ms; refund initiation bounded by Stripe/tRPC latency
**Constraints**: E2E‑first, end‑to‑end type safety; progressive disclosure UX; minimal schema changes
**Scale/Scope**: Typical tenant sizes; per‑option policies; no multi‑item orders

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Simplicity**:
- Projects: 1 web app (frontend+backend combined) + tests
- Using frameworks directly (Angular, tRPC, Drizzle) – no wrappers
- Single data model end‑to‑end; Effect Schema for validation only
- Avoid extra patterns; reuse current modules/routes/components

**Architecture**:
- Feature code integrated under existing folders: `src/server/trpc/events/**`, `src/server/trpc/templates/**`, `src/server/trpc/tenants/**`, `src/app/**`, `src/db/schema/**`
- No CLI needed; E2E tests and documentation tests drive validation
- Docs generated via `.doc.ts` per constitution

**Testing (NON-NEGOTIABLE)**:
- RED‑GREEN‑Refactor: Add failing Playwright and contract tests first
- Order: E2E → Contract → Integration → Unit
- Documentation tests generate user‑facing docs for settings/options/cancellation flow
- Real dependencies (DB, Stripe via existing webhook/adapter); no mocks for main flows
- FORBIDDEN: implementation before tests

**Legacy Migration (data‑only)**:
- Migration Impact included in this plan’s Phase 1 outputs
   - New fields are additive and default to inheritance; no backfill required for existing options to keep behavior unchanged
   - Registration snapshot applies to new registrations; existing registrations without a snapshot fall back to effective policy at cancellation time (documented)
   - Idempotent migration steps and seed updates for e2e included in tasks
- IMPORTANT: No full migration during development; deliver TypeScript ETL under `migration/steps/*`; cut‑over later

**Observability**:
- Structured logging on cancellation attempts, decisions, and refunds (amounts, fee inclusion flags)
- Clear error messages surfaced to the UI; SSR logs unified

**Design System & UI Standards**:
- Material 3 + Angular Material + Tailwind tokens; `<fa-duotone-icon>` icons
- Progressive disclosure: collapsed single policy with optional per‑variant overrides; non‑nullable typed forms
- Accessibility: keyboardable forms, clear cutoff/refund copy, proper labels

**Documentation & Knowledge Sharing**:
- Documentation tests planned; generated docs under `e2e/tests/**.doc.ts`
- PR will include preview of generated docs

**Versioning**:
- Internal BUILD increments; no external breaking APIs

## Project Structure

### Documentation (this feature)
```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
├── migration.md         # Optional: legacy impact & migration plan (if applicable)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
# Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure]
```

**Structure Decision**: Web application (frontend + backend in single repo)

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: `research.md` with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per endpoint
   - Assert request/response schemas
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Update agent file incrementally** (O(1) operation):
   - Run `/scripts/bash/update-agent-context.sh copilot` for your AI assistant
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

**Output**: `data-model.md`, `/contracts/*`, failing tests, `quickstart.md`, agent-specific file

### Optional: Migration Plan (if legacy data involved)
- Create `migration.md` including: data mapping rules (old → new), defaults/backfills for new fields, idempotency and verification, failure handling/(optional) rollback, and required seed data updates.

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each contract → contract test task [P]
- Each entity → model creation task [P] 
- Each user story → integration test task
- Implementation tasks to make tests pass

**Ordering Strategy**:
- TDD order: Tests before implementation 
- Dependency order: Models before services before UI
- Mark [P] for parallel execution (independent files)

Note: We are not generating a `tasks.md` file at this time; use the Core Implementation Map below for execution order.

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented

---
*Based on Constitution 1.1.3 - See `.specify/memory/constitution.md`*

---

Artifacts generated by this plan:
- Research: `/Users/hedde/code/duplicates/evorto/specs/004-registration-cancellation-configuration/research.md`
- Data model: `/Users/hedde/code/duplicates/evorto/specs/004-registration-cancellation-configuration/data-model.md`
- Contracts (tRPC + Effect Schema shapes): `/Users/hedde/code/duplicates/evorto/specs/004-registration-cancellation-configuration/contracts/contracts.md`
- Quickstart: `/Users/hedde/code/duplicates/evorto/specs/004-registration-cancellation-configuration/quickstart.md`

---

## Core Implementation Map (with references)

This sequence maps implementation steps to the design docs and planned tasks to make execution unambiguous.

1) Database schema (Drizzle) — additive fields
   - Tenants: add `cancellation_policies` JSONB in `src/db/schema/tenants.ts`
   - Template options: add `useTenantCancellationPolicy` (bool, default true) and `cancellationPolicy` (JSONB) in `src/db/schema/template-registration-options.ts`
   - Event options: same two fields in `src/db/schema/event-registration-options.ts`
   - Registrations: add `effectiveCancellationPolicy` (JSONB), `effectivePolicySource` (varchar), `cancelledAt` (timestamp), `refundTransactionId` (varchar), `cancellationReason` (enum), `cancellationReasonNote` (text) in `src/db/schema/event-registrations.ts`
   - References: data-model.md (New/Updated Entities), research.md (Key Decisions 1, 2)

2) Types/helpers (TS)
   - Define `CancellationPolicy` and variant types for internal use in `src/types/cancellation.ts` (optional helper used by Drizzle $type and tRPC schemas)
   - References: data-model.md (types block), contracts.md (Effect Schema shapes)

3) Tenants tRPC procedures
   - `tenants.getCancellationPolicies`, `tenants.setCancellationPolicies` with Effect Schema I/O and admin permission
   - References: contracts.md (tRPC procedures; SetTenantPoliciesInput, GetTenantPoliciesOutput), research.md (Key Decisions 7)

4) Options policy API (templates/events)
   - Read/write `useTenantCancellationPolicy` and `cancellationPolicy` for template and event options
   - References: contracts.md (OptionPolicy), data-model.md (template/event option fields), research.md (Key Decisions 1, 8)

5) Registration snapshot at purchase
   - In `events.registerForEvent`, resolve variant (paid/free × regular/organizer), choose tenant default or option override, and persist `effectiveCancellationPolicy`/`effectivePolicySource`
   - References: research.md (Key Decisions 2), data-model.md (registration snapshot), contracts.md (shapes)

6) Cancel registration (confirmed regs)
   - New procedure `events.cancelRegistration`: permission checks (self/admin/organizer); enforce new permissions `events:registrations:cancel:any` to cancel others and `events:registrations:cancelWithoutRefund` to allow no-refund on paid events; optional `reason`/`reasonNote` (enum + note). Evaluate snapshot vs current event start, compute refund per fee flags and amount paid, initiate refund with Stripe (connected account), update status, `cancelledAt`, `cancellationReason`; rely on webhooks to record the refund transaction
   - References: research.md (Key Decisions 3, 6, 10 and Best Practices — Stripe/Refunds, Permissions), data-model.md (snapshot + optional `cancellationReason`), spec.md (Acceptance Scenarios 2–7, 10–16), contracts.md (CancelRegistrationInput)

7) Pending registration cancellation (unchanged)
   - Keep `events.cancelPendingRegistration` as-is; ensure tests continue to pass
   - References: research.md (Key Decisions 10)

8) Event creation from template — policy edits
   - Ensure large prefilled form can edit cancellation policy per option; server persists changes to event option fields
   - References: research.md (Key Decisions 8), data-model.md (event option fields note)

9) UI surfaces
   - Admin Settings → Cancellations (combined editor + advanced per-variant overrides)
   - Registration option forms: inheritance toggle and override form
   - Registration detail: policy summary, reason selection (enum with optional note), and cancel action visibility with confirmation dialog
   - References: quickstart.md (steps), research.md (Key Decisions 4)

10) Logging & audit
   - Add structured logs for cancellation attempts, decisions, refunds (amounts, fee flags)
   - References: research.md (Observability notes)

11) Tests-first validation
   - Contract tests for tenants/options/cancel; E2E for visibility and flows; documentation test for quickstart journey
   - References: contracts.md (tRPC procedures), quickstart.md, spec.md (Acceptance Scenarios)

12) Migration (prototype scope)
   - Backfill `effectiveCancellationPolicy` for existing registrations using current option override/tenant default and option’s `isPaid`/`organizingRegistration`
   - References: research.md (Key Decisions 9), data-model.md (Migrations)

---

## Permissions (new)

- `events:registrations:cancel:any` — Allows cancelling registrations of other users (beyond self-cancellation).
- `events:registrations:cancelWithoutRefund` — Allows cancelling paid registrations without issuing a refund (overrides default refund behavior when policy would otherwise refund).

These permissions integrate with `events.cancelRegistration` checks and UI visibility. Self-cancellation by a participant does not require these.
