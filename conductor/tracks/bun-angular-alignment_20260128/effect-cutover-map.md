# Effect Cutover Map (Phase 5)

## Goal

Replace Express+tRPC request handling and ad-hoc service wiring with Effect-first boundaries in incremental vertical slices, while keeping the app runnable at each checkpoint.

## Current Boundary Snapshot

- HTTP runtime: `src/server/app.ts` (Express middleware + tRPC adapter).
- RPC contracts/handlers: `src/server/trpc/**`.
- Angular RPC client glue: `src/app/core/trpc-client.ts`, `src/app/app.config.ts`.
- DB access: `src/db/database-client.ts` + direct Drizzle usage in routers.

## Target Boundary Snapshot

- HTTP runtime: Effect Platform HTTP (Bun runtime first-class).
- RPC contracts: shared Effect RPC contracts package/module.
- RPC handlers: Effect handlers grouped by domain with typed error channels.
- Client integration: Effect RPC + TanStack Query helper layer.
- DB layer: Effect-provided DB service (Drizzle + Effect Postgres integration path).

## Replacement Order (Module-by-Module)

1. **Effect runtime utilities (foundation)**
   - Add `src/server/effect/**` helpers for running/providing Effect programs.
   - Add initial environment/service layers (config, logger, clock, db service tags).

2. **Low-risk read-only endpoints (vertical slices)**
   - Start with `config` and `icons` reads.
   - Move procedural logic into Effect programs while still invoked through tRPC endpoints.

3. **Auth + tenant context boundary**
   - Introduce Effect context for authenticated user + tenant.
   - Migrate context derivation middleware responsibilities to Effect-friendly adapters.

4. **Write-path domains with moderate complexity**
   - `templates`, `admin/roles`, `discounts`.
   - Model expected domain errors in typed Effect error channels.

5. **High-complexity domains**
   - `events`, `finance`, receipt media flows, Stripe webhooks.
   - Convert transactional flows to Effect with explicit retry/timeout semantics.

6. **RPC protocol cutover**
   - Introduce Effect RPC contracts under `src/shared/rpc-contracts/**`.
   - Replace tRPC server adapters with Effect RPC server integration.
   - Replace Angular tRPC client provider with Effect RPC query helper provider.

7. **Express decommission**
   - Replace `src/server/app.ts` with Effect Platform HTTP app wiring.
   - Remove Express middleware/dependencies.

## Contract Sharing Strategy (Server + Client)

1. Define RPC schemas/contracts in a shared module under `src/shared/rpc-contracts/**`.
2. Contracts contain only schemas and RPC definitions, no server implementation imports.
3. Server handlers import shared contracts and attach implementations.
4. Client imports the same shared contracts to generate typed query helpers.
5. Keep transport wiring and runtime dependencies isolated per side (server/client) to avoid bundle leakage.

## First Vertical Slice Definition

- Domain: `config.public`
- Current endpoint: tRPC `config.public`
- Migration step:
  - Move endpoint business logic into `src/server/effect/config/public-config.effect.ts`.
  - Execute via `Effect.runPromise` inside the existing tRPC procedure.
  - Keep output schema and response shape unchanged.
- Success criteria:
  - Build/lint remain green.
- Runtime behavior unchanged for `config.public`.
- Provides reusable Effect boundary pattern for next slices.

## Phase 6 Learnings (Recorded Context)

- `RpcServer.toWebHandler` currently fits cleanly for request paths that do not require per-request app context (tenant/user/auth) in the layer.
- Attempting to push request-scoped context tags into the `toWebHandler` layer caused type-level incompatibilities for the current wiring.
- Near-term safe migration path:
  - Keep tenant/auth-sensitive config endpoints on tRPC temporarily.
  - Continue migrating context-free reads and deterministic writes to Effect RPC first.
  - Revisit request-scoped context via Effect RPC middleware strategy before migrating auth/tenant domains.

## Phase 6 Update (Tenant Context Bridge)

- Added explicit request-context bridge headers for tenant/auth/permissions in `src/server/effect/rpc/app-rpcs.web-handler.ts`.
- `config.tenant` now runs through Effect RPC using shared `Tenant` schema decode in `src/server/effect/rpc/app-rpcs.handlers.ts`.
- Angular `ConfigService` and admin settings invalidation paths now consume `config.tenant` via Effect RPC helpers.
- Remaining note:
  - SSR runtime smoke in local shell still requires exporting OIDC env vars (`CLIENT_ID`, `CLIENT_SECRET`, `ISSUER_BASE_URL`, `SECRET`) before `bun run serve:ssr:evorto`.

## Phase 6 Update (tRPC Config Decommission)

- After migrating all Angular config callsites to Effect RPC, the server-side tRPC `config` namespace was removed from `src/server/trpc/app-router.ts`.
- Obsolete file `src/server/trpc/core/config.router.ts` was deleted to reduce dual-protocol maintenance and accidental regressions.

## Phase 6 Update (SSR RPC Transport)

- Effect RPC Angular client now resolves `/rpc` differently by runtime:
  - Browser: relative `/rpc`.
  - SSR/server: absolute `${BASE_URL}/rpc` (fallback `http://localhost:4200/rpc`).
- This removes server-side `RpcClientError: Failed to send HTTP request` failures observed in local Docker SSR when resolving `config.tenant` during route rendering.

## Phase 6 Update (Events Router Decommission)

- Migrated the remaining event registration lifecycle procedures to Effect RPC:
  - `events.registerForEvent`
  - `events.cancelPendingRegistration`
  - `events.registrationScanned`
- Updated Angular callsites to `AppRpc` helpers in:
  - `event-registration-option`
  - `event-active-registration`
  - `handle-registration`
- Removed tRPC events namespace composition from `src/server/trpc/app-router.ts`.
- Deleted obsolete tRPC events router/procedure files under `src/server/trpc/events/**`.
