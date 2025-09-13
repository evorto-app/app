# Evorto SDD Constitution

This constitution governs how specifications become plans, tests, and code in this repository. It harmonizes Spec‑Driven Development (SDD) with our Angular 20 + SSR stack, typed data layer (Drizzle), and tRPC contracts validated by Effect Schema.

Scope: Spec‑Kit templates and commands already enforce process gates (spec/plan/tasks flow, constitution checks, checklists, and file scaffolding). This constitution focuses on stack‑specific rules, type safety, Angular patterns, and migration policy — not what Spec‑Kit handles automatically.

## Core Principles (Articles)

### Article I: Library‑First Principle

- Every capability begins life as a reusable unit with clear boundaries and minimal dependencies.
  - UI: standalone Angular components/services under `src/app/<feature>` with OnPush change detection, signals, typed non‑nullable forms, and native control flow.
  - Server: libraries/services under `src/server/**` or shared libs in `src/shared/**` with explicit contracts and Effect Schema validation.
- Prefer reuse via libraries/shared utilities over monoliths.

### Article II: Optional CLI & Harnesses

- CLIs for server libraries and non‑product UI pages are OPTIONAL.
- Prefer E2E tests (including documentation tests) as the primary validation surface.
- Add a CLI or demo page only when it materially improves debugging or stakeholder review.

### Article III: E2E‑First TDD (NON‑NEGOTIABLE)

- Write tests first → get approval → confirm they FAIL (Red) → implement → Refactor.
- Emphasis order: E2E → Contract → Integration → Unit.
- E2E tests MUST validate functional and non‑functional constraints (auth, roles, perf budgets, a11y where applicable).
- Prefer real integrations (actual DB/services) over mocks. Unit tests are optional and added when they provide unique value.
- Where API contracts are critical, add contract tests for request/response schemas and edge cases.

### Article IV: Spec‑First, Plan‑Driven Development

- Specifications in `specs/**` are the single source of truth. Code serves specs.
- Use `/specify`, `/plan`, and `/tasks` to progress from intent → plan → executable tasks.
- All ambiguities must be marked `[NEEDS CLARIFICATION]` and resolved before implementation tasks are generated.
- Implementation changes that materially affect behavior must be reflected back into the spec and plan.

### Article V: Observability & Debuggability

- Text I/O for CLIs ensures local debuggability; support JSON output for structured pipelines.
- Use structured logging with useful context; unify frontend/SSR logs for traceability.

### Article VI: Versioning & Breaking Changes

- Libraries and contracts follow `MAJOR.MINOR.BUILD` versioning.
- Increment BUILD on any change; bump MAJOR for breaking changes with a migration plan and parallel tests where feasible.

### Article VII: Simplicity Principle

- Start simple (YAGNI). Avoid future‑proofing and unnecessary layers. Justify complexity when constraints require it.

### Article VIII: Anti‑Abstraction Principle

- Use frameworks directly; avoid generic wrappers and premature patterns (e.g., Repository/UoW) unless proven by constraints.
- Maintain a single model representation end‑to‑end; introduce DTOs only for transport differences.

### Article IX: Integration‑First Testing

- Prefer realistic environments: actual DBs/services over mocks. Validate SSR and API paths end‑to‑end.
- Permissions in tests:
  - Every unit, integration, and E2E suite explicitly annotates permissions in scope (requires/denies/dependencies) for the actor(s) under test.
  - Effectiveness must be tested: authorized paths succeed; unauthorized paths are denied with the correct, typed failure and no side effects; include minimal‑required vs. insufficient permission boundaries.
  - Verify assignment correctness and useful granularity (avoid unnecessary wildcards), and enforce declared dependencies.
  - Reference: see `SDD.md` for the general SDD approach.

## Additional Constraints & Stack Standards

- Paths and Structure: follow repo layout
  - App: `src/app/**`; Server & SSR: `src/server/**` (tRPC, middleware, webhooks); DB: `src/db/**` (Drizzle in `src/db/schema`).
  - Shared types/utilities: `@shared/*`, `@types/*`; prefer path aliases `@app/*`, `@server/*`, `@db/*`.
- Build & Ops: `yarn build` builds client + SSR; `yarn serve:ssr:evorto` serves SSR bundle; use `yarn docker:start` for local services.
- Lint/Format: `yarn lint`/`yarn lint:fix` and `yarn format` must be clean before merge.
- E2E & Documentation Tests:
  - Primary validation via Playwright E2E in `e2e/**`.
  - Documentation tests (`*.doc.ts`) generate living markdown docs (see `e2e/tests/README.md`).
  - Commands: `yarn e2e`, `yarn e2e:ui`, `yarn e2e:docs`.
- Type Safety (Repository Contract):
  - End‑to‑end types across the stack are mandatory.
  - API: Every tRPC input/output uses Effect `Schema`; leverage inferred TS types; narrow `unknown` at boundaries.
  - DB: Prefer Drizzle typed schema/helpers; derive and propagate inferred types to callers.
  - Client: Fully typed Angular code, typed queries (`injectQuery`), typed signals/inputs/outputs, non‑nullable forms.
  - Avoid `any` and unsafe casts; keep object shapes single‑sourced and avoid duplicates.
- Angular Modern Patterns (Non‑Negotiable):
  - Standalone components (no NgModules) and do NOT set `standalone: true` explicitly.
  - `ChangeDetectionStrategy.OnPush` by default; templates remain logic‑light and rely on services/computed signals.
  - Signals for local state; use `set`/`update` (avoid `mutate`); use `computed()` for derived values.
  - Use `inject()` for DI and `providedIn: 'root'` for singletons.
  - Prefer `host` metadata over `@HostBinding`/`@HostListener` decorators.
  - Prefer native control flow (`@if`, `@for`, `@switch`) and `class`/`style` bindings (not `ngIf/ngFor`, `ngClass/ngStyle`).
  - Use `NgOptimizedImage` for static assets; avoid inline base64 with it.

## Legacy Migration Policy (Per‑Feature Scripts, One‑Go Execution)

- Per‑Feature migration is the standard. Each feature delivers its TypeScript data migration steps and backfills alongside the code. Plans MUST include a Migration Impact section that covers:
  - Data mapping from old DB → new DB (tables/fields), including defaults/backfills for new fields
  - Idempotency strategy and verification checks (e.g., counts, referential integrity)
  - Any required test seed updates so the feature is testable without the migration

- All new features MUST either adapt existing legacy data or provide safe defaults/backfills so E2E remains green without manual data fixes. Features MUST also add necessary seed data to allow testing.

- Execution Model:
  - The actual data migration executes in ONE GO at cut‑over time.
  - Migration script DEVELOPMENT happens per feature during normal delivery.
  - Migration is data‑only (TypeScript ETL from old DB → new DB). No redirects/routing changes, no feature flags at this stage, no parity tests, and no API deprecations.
  - Migration code must be idempotent and safe to run incrementally during development; the final execution runs end‑to‑end once.

## Development Workflow & Quality Gates

- Branch naming: `[###-feature-name]`; include purpose/scope in PR and link to spec.
- CI must pass build, lint, unit, and e2e where applicable.
- Tests live next to code (`*.spec.ts`) and in `e2e/**` (Playwright). Keep tests deterministic and fast; prefer contract/integration coverage first.
- Before Angular changes, retrieve current Angular best practices and verify usage of standalone components, typed non‑nullable forms, and modern control flow.

## Governance

- This constitution supersedes other practices for SDD‑generated work. All PRs must verify compliance or document justified exceptions.
- Amendments require:
  - Rationale and impact analysis in the PR.
  - Updates to affected templates/checklists under `.specify/**`.
  - Version bump and dated amendment entry below.
- Complexity must be justified with concrete constraints; speculative features are prohibited.
- Use the `.specify/templates/*` files, follow the execution flow in `/plan`, and keep documentation living and in sync with code.

**Version**: 1.0.1 | **Ratified**: 2025-09-13 | **Last Amended**: 2025-09-13

### Amendment History

- 1.0.1 (2025-09-13): Added explicit permission‑testing requirements (annotation, effectiveness, assignment granularity) with SDD reference under Article IX.
- 1.0.0 (2025-09-13): Initial ratification; E2E‑first TDD; CLIs optional; documentation tests included; Angular modern patterns enforced; end‑to‑end type safety mandated.

