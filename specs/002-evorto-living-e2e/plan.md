# Implementation Plan: Evorto Living E2E Baseline


**Branch**: `002-evorto-living-e2e` | **Date**: 2025-09-13 | **Spec**: `/Users/hedde/code/evorto/specs/002-evorto-living-e2e/spec.md`
**Input**: Feature specification from `/specs/002-evorto-living-e2e/spec.md`

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
Establish a deterministic, isolated multi-tenant Playwright baseline that: (1) validates core user journeys (account, templates, categories, events, free registration, roles/permissions, unlisted visibility, profile, scanning) and (2) generates living narrative documentation (markdown + screenshots) via `.doc.ts` tests. Finance, tax, discount, and paid registration flows are excluded initially. Technical approach: per-run tenant seeding with time-relative events, storage state reuse, environment-tagged optional first-time journey, reporter parameterization via DOCS_OUT_DIR / DOCS_IMG_OUT_DIR, resilient role/text selectors, and tagging to exclude out-of-scope tests.

## Technical Context
**Language/Version**: TypeScript (Node 18+/Angular 17/20 range per repo)  
**Primary Dependencies**: Angular SSR stack, Playwright, Drizzle ORM, tRPC + Effect Schema, custom documentation reporter  
**Storage**: PostgreSQL (DATABASE_URL)  
**Testing**: Playwright (functional + docs projects), potential contract/integration via tRPC later  
**Target Platform**: Web (SSR + browser)  
**Project Type**: web (frontend + backend in unified repo)  
**Performance Goals**: Fast deterministic E2E (<5 min full baseline); doc generation overhead minimal (<15% added time)  
**Constraints**: Deterministic seeding; isolation per run; no finance/tax logic; resilient selectors (role/text); skip optional journey if Auth0 creds missing  
**Scale/Scope**: Baseline ~8-9 journeys (.doc) + ~5-6 regression tests; seeding < 100 inserted rows per run

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Simplicity**:
- Projects: 1 (app + e2e tests) — within limit
- Using framework directly? Yes (Angular + tRPC direct)
- Single data model? Yes (shared types via Drizzle/tRPC schemas)
- Avoiding patterns? Yes (no repository/UoW added)

**Architecture**:
- EVERY feature as library? Existing modular folders; no new abstractions
- Libraries listed: reuse `src/app/...` feature modules & `src/server` procedures; add only seed/permission helper under `e2e/utils`
- CLI per library: Not required
- Library docs: Not needed (test-focused feature)

**Testing (NON-NEGOTIABLE)**:
- RED-GREEN-Refactor: Enforced — add failing tests before seed/helper adjustments
- Commit order: Will show tests first
- Order: E2E primary; contract/integration optional later
- Constraints: Auth/roles & deterministic timing validated
- Documentation tests: Yes (`*.doc.ts` journeys)
- Real dependencies: Yes (Postgres, no mocks)
- FORBIDDEN violations: None planned

**Legacy Migration (data‑only)**:
- Not applicable (no legacy transformation). No migration.md created.

**Observability**:
- Structured logging: Existing; seed helper will log tenant + entity map
- Unified logs: Existing SSR + backend maintained
- Error context: Enhanced by printing seed summary on failure

**Versioning**:
- Internal tests; no version bump required
- No breaking API surfaces added
- Future contract versioning deferred until externalized

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

**Structure Decision**: Option 1 (single project) retained

## Implementation Sequence (Explicit Execution Order)
This sequence supersedes the generic Phase 2 description and directly maps to concrete repo locations. It is authoritative while `tasks.md` is intentionally absent.

### Block A: Inventory & Tagging
1. Inventory existing doc + test coverage (create `e2e/tests/test-inventory.md`).
2. Tag finance/discount out-of-scope tests with `@finance`: paths `e2e/tests/finance/**`, `e2e/tests/profile/discounts.doc.ts`.
3. In `e2e/tests/events/register.doc.ts`, isolate paid flow steps and tag with `@finance` so free path remains baseline.
4. Add conditional skip for first-time account doc in `e2e/tests/users/create-account.doc.ts`:
   `test.skip(!process.env.AUTH0_CLIENT_ID, 'Auth0 creds missing')`.

### Block B: Seeding & Isolation
5. Create `e2e/utils/seed.ts` exporting `seedBaseline({ runId }): Promise<SeedResult>` performing: tenant creation, categories (>=2), templates (free + paid), events (upcoming free, upcoming paid, past), initial registration for scanning.
6. Deterministic naming: base names + `runId` suffix; log JSON map via `console.info('[seed-map]', JSON.stringify(map))`.
7. Extend existing Playwright global setup (file: `e2e/setup/database.setup.ts`—create or augment) to call `seedBaseline` once; persist `runId` & `tenantId` to `.e2e-runtime.json`.
8. Add fixture in `e2e/fixtures/base-test.ts` to set `evorto-tenant` cookie using persisted `tenantId`.

### Block C: Storage State Refresh
9. Update `helpers/user-data.ts` adding freshness check (mtime < 24h) and tenant match (if tenant encoded in state; else always reuse).
10. Add script `e2e/utils/generate-states.ts` to (re)login roles when stale; invoked manually or from package script.

### Block D: Permission Overrides
11. Create `e2e/utils/permissions-override.ts` with `applyPermissionDiff({ roleName, add, remove })` using DB helper in `helpers/database.ts`.
12. Expose a test fixture `permissionOverride` (file: `e2e/fixtures/parallel-test.ts`) applying overrides before page navigation when used.

### Block E: Reporter Refactor
13. Refactor `e2e/reporters/documentation-reporter.ts`:
   - Read `DOCS_OUT_DIR` (default `test-results/docs`) & `DOCS_IMG_OUT_DIR` (default `test-results/docs/images`).
   - Remove hard-coded absolute paths.
   - Create folder per test slug under docs root; images all inside a unified images folder OR per-journey subfolder (choose per current code: keep per-journey for isolation).
14. Add optional permissions callout support: if first attached markdown block contains a YAML front matter style `Permissions:` list or a separate attachment named `permissions`, render standardized callout block.
15. Ensure front matter contains ONLY `title` line; strip extraneous content.
16. Log resolved paths at `onBegin` for observability.

### Block F: Test Adjustments / Additions
17. Add scanning functional regression test `e2e/tests/scanning/scanner.test.ts` (assert attendance transition) distinct from doc test.
18. Add smoke test `e2e/tests/smoke/app-load.test.ts` (homepage + templates list visible).
19. Add unlisted listing restriction functional test if not present (`e2e/tests/events/unlisted-visibility.test.ts`).
20. Normalize selectors (role/text) across existing regression tests; introduce minimal `data-testid` only where ARIA insufficient.
21. Ensure free registration regression test exists or create `e2e/tests/events/free-registration.test.ts` (assert success state & capacity decrement if available).

### Block G: Screenshot & Attachment Discipline
22. Introduce lightweight helper `e2e/utils/doc-screenshot.ts` factoring current `takeScreenshot` highlight logic; keep existing API re-export for backward compatibility.
23. Update doc tests incrementally to use new helper (optional, non-breaking).

### Block H: CI Workflow Integration
24. (If absent) create workflow `.github/workflows/e2e-baseline.yml` running: install → docker services → global seed (implicit) → functional tests → docs tests → upload `playwright-report/` + `test-results/docs`.
25. Add grep invert for `@finance` in docs project run on CI (config or CLI arg).
26. Enforce single worker on CI via config conditional `process.env.CI`.

### Block I: Verification & Hardening
27. Execute two consecutive local runs verifying deterministic artifact replacement.
28. Update `quickstart.md` with reporter env variable examples & tag usage.
29. Capture observed run durations; add to `research.md` (Performance note) once collected.
30. Mark plan Gate 'Complexity deviations' as PASS (none) or document if adjustments introduced.

## Cross-References
| Concern | Primary File(s) | Related Plan Decision |
|---------|-----------------|-----------------------|
| Seeding & isolation | `e2e/utils/seed.ts`, `e2e/setup/database.setup.ts` | D1, D2, D11 |
| Time-relative events | `e2e/utils/seed.ts` | D2 |
| Reporter env param | `e2e/reporters/documentation-reporter.ts` | D4, D12 |
| Permissions overrides | `e2e/utils/permissions-override.ts` | D7 |
| Storage state freshness | `helpers/user-data.ts`, `e2e/utils/generate-states.ts` | D5 |
| Tagging & skips | `e2e/tests/*/*.doc.ts`, Playwright config | D6, D13 |
| Screenshot discipline | `e2e/utils/doc-screenshot.ts` | D9 |
| Deterministic naming map | `e2e/utils/seed.ts` | D11 |
| Scanning coverage | `e2e/tests/scanning/scanner.test.ts` | D14 |

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
- [ ] Complexity deviations documented (none needed)

---
*Based on Constitution 1.0.0 - See `/memory/constitution.md`*
