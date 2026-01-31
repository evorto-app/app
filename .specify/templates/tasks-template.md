# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Execution Flow (main)

```
1. Load plan.md from feature directory
   → If not found: ERROR "No implementation plan found"
   → Extract: tech stack, libraries, structure
2. Load optional design documents:
   → data-model.md: Extract entities → model tasks
   → contracts/: Each file → contract test task
   → research.md: Extract decisions → setup tasks
3. Generate tasks by category:
   → Setup: project init, dependencies, linting
   → Tests: E2E tests first (incl. documentation tests), then contract/integration as needed
   → Core: models, services, API routes, UI components/pages (CLI OPTIONAL)
   → Integration: DB, middleware, logging
   → Polish: unit tests (optional), performance, docs
4. Apply task rules:
   → Different files = mark [P] for parallel
   → Same file = sequential (no [P])
   → Tests before implementation (TDD)
5. Number tasks sequentially (T001, T002...)
6. Generate dependency graph
7. Create parallel execution examples
8. Validate task completeness:
   → All contracts have tests?
   → All entities have models?
   → All endpoints implemented?
9. Return: SUCCESS (tasks ready for execution)
```

## Format: `[ID] [P?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- **Web app**: `backend/src/`, `frontend/src/`
- **Mobile**: `api/src/`, `ios/src/` or `android/src/`
- Paths shown below assume single project - adjust based on plan.md structure

## Phase 3.1: Setup

- [ ] T001 Create project structure per implementation plan
- [ ] T002 Initialize [language] project with [framework] dependencies
- [ ] T003 [P] Configure linting and formatting tools

## Phase 3.2: Tests First (E2E‑first TDD) ⚠️ MUST COMPLETE BEFORE 3.3

**CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation**

- [ ] T004 [P] E2E happy‑path flow in e2e/tests/[feature].spec.ts
- [ ] T005 [P] E2E role/permissions constraints in e2e/tests/[feature].spec.ts
- [ ] T006 [P] Documentation test journey in e2e/tests/[feature].doc.ts (ensure it generates updated user-facing docs for the feature)
- [ ] T007 [P] Contract tests for critical endpoints in tests/contract/[feature].spec.ts

### If migrating legacy data

- [ ] T00A [P] Implement TypeScript ETL step(s) under `migration/steps/*` with clear mapping rules (old → new)
- [ ] T00B [P] Add idempotent defaults/backfills for new fields
- [ ] T00C Add verification checks (counts/integrity) and failure handling; document optional rollback
- [ ] T00D Update `helpers/database.ts` or seeds to include minimal data for feature testability

## Phase 3.3: Core Implementation (ONLY after tests are failing)

- [ ] T008 [P] Data model(s) in src/db/schema/[feature].ts or src/shared/models/[feature].ts
- [ ] T009 [P] Service(s) in src/server/services/[feature].ts or src/app/[feature]/data/[feature].service.ts
- [ ] T010 [P] API router/endpoint(s) in src/server/trpc/[feature]-router.ts
- [ ] T011 [P] UI route/component(s) in src/app/[feature]/
- [ ] T011a Ensure UI complies with Material 3 + Angular Material + Tailwind standards (theme tokens, responsive list–detail where applicable, `<fa-duotone-icon>` usage)
- [ ] T012 Input validation with Effect Schema (server)
- [ ] T013 Error handling and structured logging

### If migrating a legacy feature

- [ ] T013a Backfill job + verification queries (if needed)

## Phase 3.4: Integration

- [ ] T014 Connect services to DB (Drizzle)
- [ ] T015 Auth/context middleware for tRPC
- [ ] T016 Request/response logging
- [ ] T017 CORS and security headers

## Phase 3.5: Polish

- [ ] T018 [P] Unit tests for critical pure logic (optional)
- [ ] T019 Performance validations (< defined budget)
- [ ] T020 [P] Update documentation (including generated docs from .doc.ts)
- [ ] T020a Add feature README design note with Material 3 references, screenshots, and note any theme/token updates
- [ ] T020b Capture documentation preview assets (screenshots or rendered markdown snippet) from `.doc.ts` output for PR description
- [ ] T021 Remove duplication
- [ ] T022 Run quickstart.md and manual-testing.md

## Dependencies

- Tests (T004‑T007) before implementation (T008+)
- Data models/services block API and UI tasks
- Middleware/auth blocks protected routes
- Implementation before polish (T018+)

## Parallel Example

```
# Launch T004-T007 together:
Task: "Contract test POST /api/users in tests/contract/test_users_post.py"
Task: "Contract test GET /api/users/{id} in tests/contract/test_users_get.py"
Task: "Integration test registration in tests/integration/test_registration.py"
Task: "Integration test auth in tests/integration/test_auth.py"
```

## Notes

- [P] tasks = different files, no dependencies
- Verify tests fail before implementing
- Commit after each task
- Avoid: vague tasks, same file conflicts
- CLI tasks are OPTIONAL and only added if they materially help debugging or stakeholder review

## Task Generation Rules

_Applied during main() execution_

1. **From Contracts**:
   - Each contract file → contract test task [P]
   - Each endpoint → implementation task
2. **From Data Model**:
   - Each entity → model creation task [P]
   - Relationships → service layer tasks
3. **From User Stories**:
   - Each story → integration test [P]
   - Quickstart scenarios → validation tasks

4. **Ordering**:
   - Setup → Tests → Models → Services → Endpoints → Polish
   - Dependencies block parallel execution

## Validation Checklist

_GATE: Checked by main() before returning_

- [ ] All contracts have corresponding tests
- [ ] All entities have model tasks
- [ ] All tests come before implementation
- [ ] Parallel tasks truly independent
- [ ] Each task specifies exact file path
- [ ] No task modifies same file as another [P] task
- [ ] If migrating: ETL mapping/backfills defined; verification checks and seed updates planned

---

_Based on Constitution 1.1.3 - See `.specify/memory/constitution.md`_
