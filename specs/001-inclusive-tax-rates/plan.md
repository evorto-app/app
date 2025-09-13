# Implementation Plan: Inclusive Tax Rates (Tenant‑Scoped, Tax‑Inclusive Pricing)

**Branch**: `001-inclusive-tax-rates` | **Date**: 2025-09-13 | **Spec**: `/specs/001-inclusive-tax-rates/spec.md`
**Input**: Feature specification from `/specs/001-inclusive-tax-rates/spec.md`

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
Enable tenant administrators to import inclusive active Stripe tax rates and require creators to select exactly one compatible (inclusive & active) rate for every paid registration option (templates & events). All displayed prices are tax‑inclusive (final) and checkout passes the selected tax rate ID together with the final discounted price (no extra tax computation). Free options cannot have a tax rate. Fallback labeling (“Incl. Tax”) is used if a referenced rate becomes unresolved. All operations are tenant‑scoped and fully typed end‑to‑end using existing Angular + tRPC + Drizzle stack.

## Technical Context
**Language/Version**: TypeScript (Angular 20 frontend + Node SSR)  
**Primary Dependencies**: Angular signals & reactive forms, TanStack Query, tRPC, Effect Schema, Drizzle ORM (Postgres), Stripe SDK  
**Storage**: PostgreSQL via Drizzle (`tenant_stripe_tax_rates` table + existing registration option tables)  
**Testing**: Playwright E2E (primary), contract tests via tRPC schema validation, documentation tests (`*.doc.ts`) where helpful  
**Target Platform**: Web app (SSR) multi‑tenant  
**Project Type**: Web (frontend + backend unified in monorepo)  
**Performance Goals**: Tax rate list queries < 200ms (informational)  
**Constraints**: Tenant isolation; no additional tax math; inclusive pricing label always available (fallback generic allowed)  
**Scale/Scope**: Moderate: per tenant likely < 100 tax rates; registration options per event < 50  

No outstanding NEEDS CLARIFICATION blocking implementation; legacy registration options without tax rate require migration strategy (see Migration Impact). 

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Simplicity**:
- Projects: 1 (existing unified app: frontend + server + db)
- Using framework directly: Yes (Angular, tRPC, Drizzle, Stripe SDK direct)
- Single data model: Yes (Drizzle schema reused end‑to‑end; no DTOs)
- Avoiding extra patterns: Yes (no repositories introduced)

**Architecture**:
- Feature code lives within existing feature folders: `src/server/.../tax-rates`, `src/app/.../admin/settings`, shared types under `@shared`. Treated as modular libraries.
- CLI: Not required
- Library docs: Quickstart + contracts serve as dev docs

**Testing (NON-NEGOTIABLE)**:
- Approach: Add failing Playwright scenarios (import, create template paid option, display labels, checkout passes tax rate, fallback label)
- Contract tests: tRPC procedures with invalid/valid payloads (paid option with/without tax rate)
- Order: E2E (failing) → contract tests → implementation
- Real DB + Stripe (test mode) or mocked network at boundary only if env lacking credentials
- Documentation test: Optional; may add label rendering doc test

**Legacy Migration (data‑only)**:
- Unique index addition (tenantId, stripeTaxRateId)
- Existing registration options without tax rate when isPaid=true: migration step sets isPaid=false OR blocks until admin assigns (Decision: set isPaid=false & log) — needs stakeholder confirmation but non‑blocking (low risk number)
- Seed updates: add sample rates (0%,7%,19%) per tenant migration step + sample paid templates referencing them
- Idempotency: Upserts based on stripeTaxRateId + tenantId; safe re-run
- Verification: count of imported sample rates per tenant matches expected (3)

**Observability**:
- Logging: Import action, validation failures, fallback label usage, missing rate at checkout (warning)
- Context: tenantId, stripeTaxRateId, registrationOptionId
- Unified logs: existing logging pipeline reused

**Versioning**:
- Feature internal; no public API version bump; internal contract version tag: TAX-RATES v1.0.0 (initial)
- Future breaking change (e.g., exclusive tax support) would increment MAJOR

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

**Structure Decision**: [DEFAULT to Option 1 unless Technical Context indicates web/mobile app]

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

**Output**: research.md with all NEEDS CLARIFICATION resolved

### Phase 0 Findings (Condensed)
Key Decisions:
1. No in-app tax computation; rely solely on Stripe inclusive rates passed via tax_rates line item attribute.
2. Validation occurs server-side in template/event creation & update procedures; client enforces via required form control.
3. Fallback label strategy: if join to imported table fails, display generic “Incl. Tax” and continue.
4. Legacy paid options without a tax rate will be assigned the default imported rate resolved from `tenant.stripeReducedTaxRate` (import if absent) preserving paid status; each assignment logged.
5. Zero price after discount => treat as free (no tax rate at checkout) and label omitted; scenario rare but consistent.
6. 0% tax rate label: Display “Incl. 0% Tax” (simple) — friendly alias “Tax free” considered but keep consistent pattern.

Alternatives Considered:
- Rate caching vs on-demand: Choose on-demand read from local table only (Stripe only for admin listing/import), keeps runtime simple.
- Auto-sync provider changes: Not needed (Stripe tax rates immutable; admin re-import not required).
- Backfill assigning a default rate to legacy paid options: Rejected (risks incorrect compliance labeling).

Open (Non-blocking) Clarifications:
- Fallback behavior if `tenant.stripeReducedTaxRate` missing/invalid (plan: log & manual remediation required).

All blocking clarifications resolved → proceed to Phase 1.

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

**Output**: data-model.md, /contracts/*, failing tests, quickstart.md, agent-specific file

### Optional: Migration Plan (if legacy data involved)
Will add `migration.md` during/after Phase 1 if legacy coercion requires explicit operator instructions (pending confirmation).

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

**Estimated Output**: 25-30 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

### Preliminary Task Buckets (Preview)
1. Migration & Seeds: add unique index; seed sample rates.
2. Server Contracts: implement tRPC procedures (admin list/import/listImported, taxRates.listActive) with Effect Schemas.
3. Validation Hooks: extend template/event create/update logic for tax rate rules.
4. Checkout Integration: attach tax rate id, warnings for inactive.
5. Frontend Admin UI: import dialog + imported list (signals + TanStack Query).
6. Frontend Creator Forms: template + event option forms (reactive forms logic for enabling/disabling).
7. Display Components: price label with inclusive text & fallback.
8. E2E Tests: import flow, creation validation, display label, checkout usage, fallback scenario.
9. Logging & Observability: structured logs for import, validation failures, fallback.
10. Documentation Tests (optional) for rendering inclusive label.
11. Edge Handling: discount to zero -> treat as free.

## Core Implementation Sequence (Cross-Referenced)
1. Migration & Default Legacy Assignment → `migration.md`, `data-model.md#Migration Impact`.
1a. Permission Setup: introduce `admin:manageTaxes` (grant to roles with `admin:changeSettings` in migration) → `migration.md` update.
2. Index Creation → `data-model.md#Indices`.
3. Contract Schemas (tRPC) → `contracts/*.md` (listStripeTaxRates, importStripeTaxRates, listImportedTaxRates, taxRates.listActive).
4. Validation Integration → `contracts/templates.validation.md`, `contracts/events.create.validation.md`.
5. Checkout Wiring → `contracts/events.registerForEvent.md`.
6. Admin Import UI → Quickstart §4; uses admin.tenant.* contracts.
7. Creator Forms Behavior → Quickstart §5; relies on taxRates.listActive.
8. Price Label Component → Quickstart §6 (Display Layer) & Research fallback decision.
9. Logging Points → Quickstart §9 & Research risks mapping.
10. E2E Scenarios → Quickstart §8 mapping FRs.
11. Edge Cases Handling → Quickstart §10.

## Functional Requirement Coverage Matrix
| FR | Description (Spec) | Artifact(s) | Test Scenario Ref |
|----|--------------------|-------------|-------------------|
| FR-001 | View provider tax rates | contracts/admin.tenant.listStripeTaxRates.md | E2E: Admin imports rates |
| FR-002 | Import selected rates | contracts/admin.tenant.importStripeTaxRates.md | E2E: Admin imports rates |
| FR-003 | Tenant isolation storage | data-model.md, migration.md | Covered implicitly; add isolation test |
| FR-004 | Distinguish compatible/incompatible | Import UI design (Quickstart §4) | UI test (import dialog) |
| FR-005 | Prevent selecting incompatible | Validation contracts + form disable | E2E: Creator must select compatible |
| FR-006 | Imported list display | contracts/admin.tenant.listImportedTaxRates.md | E2E: Admin imports rates |
| FR-007 | View incompatible provider rates | listStripeTaxRates includes; UI marks disabled | E2E: Admin imports rates |
| FR-008 | Require rate for paid | templates/events validation contracts | E2E: Creator must select rate |
| FR-009 | Free forbids rate | validation contracts | E2E: Creator toggles isPaid false |
| FR-010 | Block when none imported | form logic + server validation | E2E: Creator cannot save (pre-import) |
| FR-011 | Inclusive label display | Quickstart §6, label component | E2E: Event details show label |
| FR-012 | Checkout uses final price + rate | events.registerForEvent.md | E2E: Checkout tax rate included |
| FR-013 | Continue if rate unavailable | events.registerForEvent.md + logging | E2E: Fallback scenario |
| FR-014 | Discount reduces final price | existing discount logic + label retention | E2E: Discounted price test |
| FR-015 | Persist tax rate association | DB schema reuse | Checkout + persistence test |
| FR-016 | Dev/demo seed sample rates | migration.md | Migration/E2E seed verification |
| FR-017 | Generic fallback label | label component design | E2E: Fallback scenario |
| FR-018 | Bulk/cloning safety | Server validation universal | (Add contract test) |
| FR-019 | Tenant isolation all ops | DB filters + contract queries | Multi-tenant E2E |
| FR-021 | Notify inactive use | Logging spec (checkout warning) | (Add log assertion) |
| FR-022 | Support 0% rates | Data model + label logic | E2E: 0% rate display |
| FR-023 | Audit log import/unavailability | Logging plan (import + inactive) | (Add log assertion) |
| FR-024 | Granular tax management permission | spec.md (FR-024), contracts admin.tenant.* | Permission unit/contract test |

Any FR not yet tied to explicit test marked for additional test creation.

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

- **Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved (blocking)
- [ ] Complexity deviations documented (none currently)

---
*Based on Constitution 1.0.0 - See `/memory/constitution.md`*
