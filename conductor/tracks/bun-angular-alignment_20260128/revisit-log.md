# Revisit Log — bun-angular-alignment_20260128

This file tracks migration items that need another pass before final closure.

## Open Items

- [ ] Resolve remaining docs failures after runtime fixes:
  - `tests/docs/finance/inclusive-tax-rates.doc.ts` (`Tax rate` combobox not found in organizer section during template edit)
  - `tests/docs/profile/discounts.doc.ts` (`Discounts` section button not found in profile navigation)
- [ ] Validate Bun `S3Client` Cloudflare R2 upload + presigned preview URLs in an R2-configured environment (real credentials, not local fallback).
- [ ] Confirm whether the local receipt placeholder fallback path should remain once stable local R2 strategy is in place.
- [ ] Evaluate stateless session cookie size and token-rotation behavior under production-like Auth0 payloads.
- [ ] Revisit security-header policy strictness (`Permissions-Policy` / `X-Frame-Options` defaults) after UX and integration review.
- [ ] Add focused tests for Effect/Bun auth callback/session lifecycle and Stripe webhook route behavior under the new runtime path.
- [ ] Replace temporary `@material/material-color-utilities` patch dependency with an upstream-safe dependency/version solution.
- [ ] Investigate `bun run lint:check` / `bunx --bun ng lint` "Unknown error" output in the current Angular 21 + Bun toolchain (no actionable diagnostics emitted).
- [ ] Decide whether to enable rolling Auth0 session refresh in request reads (`getSession(...)` currently used without response cookie writeback paths in SSR/RPC context).

## Recently Closed

- 2026-02-20: upgraded `@heddendorp/effect-platform-angular` from `0.0.7` to `0.0.8`, removed the temporary local patch (`patches/@heddendorp%2Feffect-platform-angular@0.0.7.patch`), and verified Bun SSR + RPC runtime (`/events`, `/rpc`) on the built server.
- 2026-02-20: upgraded `@heddendorp/effect-angular-query` from `0.1.1` to `0.1.2` and validated app/runtime compatibility (`bun run build:app`, SSR `/events`, RPC `/rpc` on Bun server).
- 2026-02-15: fixed Angular dev-SSR stabilization deadlock caused by hanging `POST /rpc` requests. Runtime-neutral request conversion now uses `HttpServerRequest.toWeb(...)` in `src/server.ts`, and RPC context header injection now rebuilds requests with a materialized body in `src/server/effect/rpc/app-rpcs.request-handler.ts` instead of `new Request(existingRequest, { headers })`.
- 2026-02-15: fixed Angular route extraction failure under Bun build runtime by setting `NG_BUILD_PARTIAL_SSR=1` for Angular build scripts (`build:app`, `build:watch`).
- 2026-02-15: reordered server route composition in `src/server.ts` to register named routes first and run static-file serving before Angular SSR within the final wildcard handler; removed duplicate SSR fallback on `RouteNotFound` in middleware.
- 2026-02-14: resolved Bun package-manager reliability issue and resumed Bun-native dependency/lockfile updates (`bun add` / `bun remove` operations now complete in this workspace).
- 2026-02-14: removed stale dependency surface and validated cleanup (`@angular/platform-browser-dynamic`, `@ng-web-apis/common`, `date-fns`, `pdfjs-dist`, `superjson`, `type-fest`, `playwright-core`; `auth0` moved to dev dependency).
- 2026-02-14: decommissioned stale null-lint suppressions and set explicit lint policy (`unicorn/no-null` disabled for this codebase baseline) with `lint`/`tsc`/`build` green.
- 2026-02-14: refreshed Playwright test inventory metadata/status (`tests/test-inventory.md`).
- 2026-02-14: confirmed legacy Express/tRPC directory cleanup is complete (`src/server/trpc`, `src/server/middleware`, `src/types/express` are absent).
- 2026-02-14: completed production-readiness audit and documented prioritized hardening sequence in `production-readiness-audit-2026-02-14.md`.
- 2026-02-14: integrated `@heddendorp/effect-platform-angular@0.0.7` transport wiring into app bootstrap and RPC client creation (`provideEffectHttpClient`, `provideEffectRpcProtocolHttpLayer`, DI-backed `AppRpc` bridge preserving existing `AppRpc.injectClient()` call sites).
- 2026-02-14: normalized package script naming to namespaced groups (`dev:*`, `build:*`, `test:*`, `db:*`, `ops:*`, `ui:*`) and aligned active docs/config workflow references.
- 2026-02-13: replaced custom auth/session crypto implementation with `@auth0/auth0-server-js` (`ServerClient`, `CookieTransactionStore`, `StatelessStateStore`) integrated via Effect HTTP cookie mutation bridge.
- 2026-02-13: aligned session model with prior Auth0 behavior by switching to stateless encrypted `appSession` cookie payloads (no server-side session key-value entries).
- 2026-02-13: restored SSR fallback for wildcard `GET` requests in Bun/Effect runtime so `/` and route misses no longer return framework `404`.
- 2026-02-13: fixed auth/session file-backed key-value `ENAMETOOLONG` failures by hashing cookie session IDs before key-value lookup/write/remove.
- 2026-02-13: updated Playwright auth setup to always refresh storage states per setup run, avoiding stale `appSession` reuse against fresh runtime session stores.
- 2026-02-13: migrated material ESM fix to Bun-native `patchedDependencies` workflow and removed custom post-install patch helper.
- 2026-02-13: completed Phase 7 full runtime cutover by replacing `src/server.ts` with Effect Platform Bun routing and deleting remaining Express runtime/server adapter files and dependencies.
- 2026-02-13: added global security headers, Effect-based webhook rate limiting, and file-backed server key-value storage under `.cache/evorto/server-kv`.
- 2026-02-13: validated auth login runtime path on Bun/Effect (`/login` redirects with PKCE state and persists transaction record to file-backed key-value store).
- 2026-02-13: adopted `bunfig.toml` (`[run].bun = true`) and removed redundant `--bun` flags from package scripts and workflow helper commands.
- 2026-02-13: switched receipt object storage integration from AWS SDK S3 client to Bun runtime `S3Client` in `src/server/integrations/cloudflare-r2.ts`.
- 2026-02-13: started Phase 7 by extracting a framework-agnostic RPC web handler and isolating Express glue in `src/server/effect/rpc/app-rpcs.express-handler.ts`.
- 2026-02-13: centralized RPC request-context header keys in `src/server/effect/rpc/rpc-context-headers.ts` and replaced duplicated literals in adapter/handlers.
- 2026-02-13: extracted non-Express auth/tenant/user request-context resolution to `src/server/context/request-context-resolver.ts` and rewired existing Express middleware wrappers.
- 2026-02-13: replaced three sequential Express context middleware steps with one `addRequestContext` adapter in `src/server/middleware/request-context.ts`.
- 2026-02-13: moved `/healthz` to a framework-agnostic web handler and introduced shared `writeWebResponse(...)` mapping in `src/server/http/write-web-response.ts`.
