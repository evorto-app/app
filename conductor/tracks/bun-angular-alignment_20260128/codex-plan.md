# Evorto Migration Plan: Effect Platform HTTP + Effect RPC + Drizzle Effect Postgres (+ Bun Runtime Attempt)

## Summary

This plan migrates `/Users/hedde/code/evorto` from `Express + tRPC + Drizzle(neon)` to `@effect/platform` HTTP + `@effect/rpc` + `drizzle-orm/effect-postgres`, while keeping Angular SSR and current product behavior.
Migration mode is a hard feature freeze and a single-service topology.
Bun runtime is targeted, with an explicit fallback to Node runtime if Bun parity fails at a defined checkpoint.

## Topology Decision (Requested Pros/Cons + Chosen Option)

- `Single service (chosen)`:
  - Pros: lowest operational burden for a solo developer, fastest end-to-end migration path, simplest debugging, no cross-service auth/session complexity.
  - Cons: API/SSR isolation and scaling are coupled.
- `Split SSR/API services`:
  - Pros: cleaner isolation, independent scaling/release.
  - Cons: much higher migration and ops overhead now (auth/session duplication, networking, deployment complexity).
- `Edge SSR + API split`:
  - Pros: potential latency gains and platform flexibility.
  - Cons: highest complexity and runtime-compat risk during this migration.
- Decision: keep one runtime process for SSR + RPC now; enforce internal module boundaries so future split is straightforward.

## Scope

- In scope:
  - Replace Express server/middleware with Effect Platform HTTP.
  - Replace tRPC server/client transport with Effect RPC.
  - Move DB integration to `drizzle-orm/effect-postgres`.
  - Preserve SSR feature and existing app capabilities.
  - Preserve current test suite coverage and pass criteria at completion.
- Out of scope:
  - New product features.
  - DB schema redesign.
  - Multi-service split now.

## Hard Constraints and Defaults

- Feature freeze: `ON` until migration completion.
- RPC migration style: `big-bang cutover` (no gradual dual-protocol in final system).
- Error modeling: strict expected/domain errors for touched routes.
- Auth strategy: cookie-session adapter in Effect HTTP middleware.
- Runtime objective: Bun-first runtime; fallback is Node runtime without reverting Effect HTTP/RPC/DB migration.
- Endpoint compatibility default: keep RPC path at `/trpc` during migration to minimize frontend route/path churn.

## Public API / Interface / Type Changes

- Server API transport:
  - Replace tRPC router contract at `/Users/hedde/code/evorto/src/server/trpc/**` with Effect RPC definitions under `/Users/hedde/code/evorto/src/server/rpc/**`.
- HTTP context model:
  - Replace Express `Request`-bound context in `/Users/hedde/code/evorto/src/server/trpc/trpc-server.ts` and `/Users/hedde/code/evorto/src/types/custom/context.ts` usage path with Effect HTTP request context service (tenant, authentication, user).
- Auth/session boundary:
  - Replace `express-openid-connect` coupling in `/Users/hedde/code/evorto/src/server/app.ts` and `/Users/hedde/code/evorto/src/server/middleware/**` with an Effect middleware chain preserving current cookie semantics (`appSession`, `evorto-tenant`).
- Client contract:
  - Replace `/Users/hedde/code/evorto/src/app/core/trpc-client.ts` with `/Users/hedde/code/evorto/src/app/core/rpc-client.ts`.
  - Provide compatibility facade methods (`query`, `mutation`, `queryOptions`, `mutationOptions`) so current Angular callsites can be updated with minimal behavioral change.
- DB integration:
  - Replace `/Users/hedde/code/evorto/src/db/database-client.ts` with Effect-backed Drizzle Postgres client layer.
  - Keep schema source of truth in `/Users/hedde/code/evorto/src/db/schema/**`.

## Migration Phases

### Phase 0: Baseline and Safety Rails

- Capture pre-migration baseline:
  - Run and store outputs for `yarn lint:fix`, `yarn lint`, `yarn build`, `yarn test`, `yarn e2e`, `yarn e2e:docs`.
- Snapshot functional baseline for key journeys:
  - Authenticated page load, tenant resolution, events list/details, finance receipts flows.
- Add migration checkpoints document in `/Users/hedde/code/evorto/conductor/tracks/...` with explicit go/no-go criteria.

### Phase 1: Effect Runtime Foundations (No Feature Changes)

- Introduce core Effect layers/services:
  - Config service, logger, clock, DB service, auth/session service, tenant resolver, user resolver.
- Build request context pipeline in Effect HTTP:
  - Parse cookies, resolve tenant, resolve auth, resolve user, attach typed context.
- Keep current SSR output behavior target documented (no visible behavior changes).

### Phase 2: Replace Express with Effect Platform HTTP

- Replace `/Users/hedde/code/evorto/src/server/app.ts` server composition:
  - Implement Effect HTTP server handlers for:
    - `/healthz`
    - `/webhooks/stripe` (raw body handling preserved)
    - `/forward-login`
    - static assets
    - SSR catch-all route
- Remove Express middleware chain and port equivalent responsibilities to Effect middleware.
- Keep existing route semantics and status/error behavior.

### Phase 3: Effect RPC Server Contracts and Handlers

- Create Effect RPC protocol modules mirroring current tRPC domains:
  - `admin`, `config`, `discounts`, `editorMedia`, `events`, `finance`, `globalAdmin`, `icons`, `taxRates`, `templateCategories`, `templates`, `users`.
- For each procedure, define:
  - Input schema
  - Success output schema
  - Expected/domain error schema (typed)
- Migrate handler implementations from `/Users/hedde/code/evorto/src/server/trpc/**` to `/Users/hedde/code/evorto/src/server/rpc/**` with parity behavior.
- Remove tRPC server bootstrap and router composition once parity verified.

### Phase 4: Drizzle Effect Postgres Migration

- Adopt `drizzle-orm/effect-postgres` in DB access layer.
- Convert prepared/query helper usage in:
  - `/Users/hedde/code/evorto/src/db/prepared-statements.ts`
  - server handlers currently depending on direct `database` calls.
- Preserve schema and migration tooling compatibility (`drizzle.config.ts`, schema files, migration scripts).

### Phase 5: Angular Client Transport Migration (Big-Bang Cut)

- Replace tRPC client provider in `/Users/hedde/code/evorto/src/app/app.config.ts`.
- Add Effect RPC client facade in `/Users/hedde/code/evorto/src/app/core/rpc-client.ts`.
- Update all callsites currently using `injectTRPC`/`injectTRPCClient` to use new facade with equivalent query/mutation ergonomics.
- Ensure query invalidation keys and mutation side effects preserve current behavior.

### Phase 6: Bun Runtime Attempt + Fallback Gate

- Target run on Bun runtime for SSR + Effect HTTP server.
- Gate criteria:
  - SSR routes render correctly.
  - Auth/session behavior matches baseline.
  - Webhooks work.
  - No blocker incompatibilities in required Node APIs/libs.
- If Bun gate fails:
  - Keep all Effect HTTP + Effect RPC + Drizzle Effect changes.
  - Run on Node runtime and close migration as successful except Bun runtime objective.
  - Track Bun runtime gaps separately for future iteration.

### Phase 7: Cleanup and Decommission

- Remove deprecated dependencies and code paths:
  - `express`, `@trpc/*`, `@heddendorp/trpc-link-angular`, `express-openid-connect`, old middleware and routers.
- Update CI/Docker scripts while preserving current test command ergonomics.
- Keep command names stable where practical to reduce workflow disruption.

## Testing and Verification Plan

### Phase Gates (Chosen)

- During implementation phases:
  - `yarn lint:fix`
  - `yarn lint`
  - `yarn build`
  - targeted smoke checks (server start, SSR route render, key auth/tenant and events/finance flows)
- Milestone checkpoints:
  - run broader e2e subsets relevant to touched surfaces.
- Final gate (must match current expectations):
  - `yarn lint:fix`
  - `yarn lint`
  - `yarn build`
  - `yarn test`
  - `yarn e2e`
  - `yarn e2e:docs`

### Required Test Scenarios

- SSR:
  - server boot, static assets, catch-all SSR route, error route behavior.
- Auth/session:
  - unauthenticated and authenticated flows, cookie forwarding, tenant cookie + host fallback.
- RPC domain parity:
  - representative query/mutation per domain with expected success and expected domain errors.
- Webhooks:
  - Stripe raw payload verification path still valid.
- Finance/events critical flows:
  - event registration lifecycle and receipt submission/review/refund flows.

## Rollback and Failure Handling

- Migration branch strategy:
  - commit per phase with green phase gate.
- Hard fallback:
  - Bun runtime only can be dropped if parity fails.
- Non-negotiable completion:
  - Effect HTTP + Effect RPC + Drizzle Effect migration remains the target completion even if runtime fallback to Node is used.

## Assumptions and Defaults

- You remain in full feature freeze throughout migration.
- Temporary breakage during development is acceptable.
- No external API consumers require backward compatibility during migration.
- Existing SSR behavior is the required product baseline.
- Single-service deployment remains the operational model after migration.
- Expected/domain errors are explicitly modeled for all migrated routes.
