# Implementation Plan: Tenant‑wide Discount Enablement with ESNcard


**Branch**: `003-discount-cards-expand` | **Date**: 2025-09-16 | **Spec**: `/Users/hedde/code/evorto/specs/003-discount-cards-expand/spec.md`
**Input**: Feature specification from `/specs/003-discount-cards-expand/spec.md`

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
Enable tenant‑wide discount providers with ESNcard as the first implementation. Keep a hard‑coded provider catalog, store tenant enablement in `tenants.discount_providers`, allow users to manage a single credential per provider with platform‑wide uniqueness, and apply the lowest eligible discounted price at registration. From research, we will consolidate provider discounts into a JSON field on registration options (templates + events), add a minimal snapshot to `event_registrations` for reporting, remove the “refresh” flow (upsert validates immediately), refine pricing tie‑breakers and validity‑on‑start, and complete UI/contract coverage with tests and documentation.

## Technical Context
**Language/Version**: TypeScript (Node.js 20+, Angular 20)  
**Primary Dependencies**: Angular Material 3, Tailwind, TanStack Query, tRPC, Effect Schema, Drizzle ORM, Postgres, Playwright  
**Storage**: Postgres via Drizzle; JSONB for tenant provider config; enums for provider/status  
**Testing**: Playwright E2E (+ documentation tests), Vitest/Jest unit where appropriate  
**Target Platform**: SSR web app (Angular) + Node server  
**Project Type**: web (frontend + backend)  
**Performance Goals**: Pricing calc O(n) over small lists; DB queries under p95 200ms  
**Constraints**: E2E‑first; type‑safe contracts; minimal schema changes; SSR‑ready UI  
**Scale/Scope**: Single tenant at a time, typical org sizes; few providers initially

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Simplicity**:
- Projects: 1 web app (frontend+backend combined repo) + tests
- Using framework directly (Angular, tRPC, Drizzle) – no wrappers
- Single data model end‑to‑end; no DTOs beyond Effect Schema
- Avoiding extra patterns; reuse existing modules

**Architecture**:
- Feature code integrated in existing folders: `src/server/discounts/**`, `src/server/trpc/**`, `src/app/**`, `src/db/schema/**`
- No CLI needed; E2E tests drive validation
- Docs generated via documentation tests per constitution

**Testing (NON-NEGOTIABLE)**:
- RED‑GREEN‑Refactor: Yes – add failing Playwright scenarios first
- Order: E2E → Contract → Integration → Unit
- Documentation tests will generate user‑facing docs for settings/profile/registration
- Real dependencies: real DB and esncard.org call via adapter (with timeouts/handling)

**Legacy Migration (data‑only)**:
- Migration Impact: Data will be migrated from the old schema (source) to the planned target structures via TypeScript steps (no raw SQL files). Focus areas: (1) user ESNcards → `user_discount_cards`, (2) event price tiers → consolidated option discounts, (3) registration snapshots from old registrations/transactions. See `migration.md` for the precise TS migration approach and verification. No full data migration executed during development; runs post‑deploy per tenant.

**Observability**:
- Structured logs for provider toggles, validation calls (status, timings), and pricing selection
- Clear error messages surfaced to UI

**Design System & UI Standards**:
- Angular Material 3 + Tailwind tokens (`src/styles.scss`); `<fa-duotone-icon>` icons
- Accessibility: keyboardable forms, clear warnings, proper roles/labels
- Integrate in existing settings/profile/event screens per screen strategy

**Documentation & Knowledge Sharing**:
- Documentation tests planned; output lives in `e2e/tests/**.doc.ts` (admin toggle, profile add card, registration pricing). Include a feature README with M3 references and screenshots; attach PR preview of generated docs per constitution.

**Versioning**:
- Internal BUILD increments; no external API breaking changes

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

**Output**: `data-model.md`, `/contracts/*`, quickstart.md, agent-specific file

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

**Estimated Output**: 25-30 numbered, ordered tasks in tasks.md

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
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
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
