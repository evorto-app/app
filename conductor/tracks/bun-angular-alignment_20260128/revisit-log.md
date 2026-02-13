# Revisit Log — bun-angular-alignment_20260128

This file tracks migration items that need another pass before final closure.

## Open Items

- [ ] Re-run targeted docs specs once Docker daemon + Neon local are available in this shell (`tests/docs/finance/inclusive-tax-rates.doc.ts`, `tests/docs/profile/discounts.doc.ts`).
- [ ] Validate Bun `S3Client` Cloudflare R2 upload + presigned preview URLs in an R2-configured environment (real credentials, not local fallback).
- [ ] Confirm whether the local receipt placeholder fallback path should remain once stable local R2 strategy is in place.
- [ ] Replace in-memory auth/session store (`KeyValueStore.layerMemory`) with a shared durable store strategy for multi-instance runtime environments.
- [ ] Reintroduce/replace removed HTTP hardening concerns from the old Express stack where needed (`helmet` equivalents, webhook rate limiting).
- [ ] Add focused tests for Effect/Bun auth callback/session lifecycle and Stripe webhook route behavior under the new runtime path.

## Recently Closed

- 2026-02-13: completed Phase 7 full runtime cutover by replacing `src/server.ts` with Effect Platform Bun routing and deleting remaining Express runtime/server adapter files and dependencies.
- 2026-02-13: switched receipt object storage integration from AWS SDK S3 client to Bun runtime `S3Client` in `src/server/integrations/cloudflare-r2.ts`.
- 2026-02-13: started Phase 7 by extracting a framework-agnostic RPC web handler and isolating Express glue in `src/server/effect/rpc/app-rpcs.express-handler.ts`.
- 2026-02-13: centralized RPC request-context header keys in `src/server/effect/rpc/rpc-context-headers.ts` and replaced duplicated literals in adapter/handlers.
- 2026-02-13: extracted non-Express auth/tenant/user request-context resolution to `src/server/context/request-context-resolver.ts` and rewired existing Express middleware wrappers.
- 2026-02-13: replaced three sequential Express context middleware steps with one `addRequestContext` adapter in `src/server/middleware/request-context.ts`.
- 2026-02-13: moved `/healthz` to a framework-agnostic web handler and introduced shared `writeWebResponse(...)` mapping in `src/server/http/write-web-response.ts`.
