# Revisit Log — bun-angular-alignment_20260128

This file tracks migration items that need another pass before final closure.

## Open Items

- [ ] Validate Bun `S3Client` Cloudflare R2 upload + presigned preview URLs in an R2-configured environment (real credentials, not local fallback).
- [ ] Confirm whether the local receipt placeholder fallback path should remain once stable local R2 strategy is in place.
- [ ] Resolve current docs test regressions from latest run:
  - `tests/docs/finance/inclusive-tax-rates.doc.ts`
  - `tests/docs/profile/discounts.doc.ts`
- [ ] Phase 7 runtime cutover: replace remaining Express-first server composition with Effect HTTP runtime wiring.

## Recently Closed

- 2026-02-13: switched receipt object storage integration from AWS SDK S3 client to Bun runtime `S3Client` in `src/server/integrations/cloudflare-r2.ts`.
