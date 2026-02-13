# Revisit Log — bun-angular-alignment_20260128

This file tracks migration items that need another pass before final closure.

## Open Items

- [ ] Re-run targeted docs specs once Docker daemon + Neon local are available in this shell (`tests/docs/finance/inclusive-tax-rates.doc.ts`, `tests/docs/profile/discounts.doc.ts`).
- [ ] Validate Bun `S3Client` Cloudflare R2 upload + presigned preview URLs in an R2-configured environment (real credentials, not local fallback).
- [ ] Confirm whether the local receipt placeholder fallback path should remain once stable local R2 strategy is in place.
- [ ] Phase 7 runtime cutover: replace remaining Express-first server composition with Effect HTTP runtime wiring.
- [ ] Phase 7 follow-up: replace Express-bound OIDC/auth middleware path with Effect-compatible auth/session boundary (current `/rpc` adapter extraction done, full runtime swap pending).

## Recently Closed

- 2026-02-13: switched receipt object storage integration from AWS SDK S3 client to Bun runtime `S3Client` in `src/server/integrations/cloudflare-r2.ts`.
- 2026-02-13: started Phase 7 by extracting a framework-agnostic RPC web handler and isolating Express glue in `src/server/effect/rpc/app-rpcs.express-handler.ts`.
- 2026-02-13: centralized RPC request-context header keys in `src/server/effect/rpc/rpc-context-headers.ts` and replaced duplicated literals in adapter/handlers.
