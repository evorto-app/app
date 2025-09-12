# Evorto — Production Readiness Overview

This document summarizes the current state of the codebase, key findings, and a prioritized roadmap to reach production. It separates actions to do now (before adding missing features) from those to do when features are complete and the product is being prepared for launch.

## Project Snapshot
- Stack: Angular 20 (SSR), Express 5 + tRPC 11, Drizzle ORM (Neon serverless), Tailwind v4, Playwright e2e, Karma unit tests.
- Structure: `src/app` (client), `src/server` (SSR + API), `src/db` (Drizzle schema), `src/shared` (shared types/utilities), `src/types` (runtime schemas), `e2e` (Playwright).
- Build: `@angular/build:application` with SSR output; Docker multi-stage build; Fly.io workflow.
- Quality/tooling: Strict TS + templates, Angular ESLint (flat), Playwright a11y fixtures, GitHub Actions for e2e and Fly deploy.

## Testing Policy (Owner Preference)
- Unit tests are not required at this stage.
- The only required testing gate is Playwright end-to-end tests (including existing a11y checks).

## Key Findings (Summary)
- SSR app and tRPC API are well structured; effect `Schema` validation on the server is a strong point.
- Signals, `inject()`, and native control flow are used consistently; Material + Tailwind theming is in place.
- E2E coverage exists across core flows and includes axe a11y checks.
- Lint rules enforce layer boundaries (client/server/db) and disallow helper imports in prod code.

### Critical Issues / Blockers
- Secrets/API keys embedded in source:
  - Sentry DSN (browser) in `src/main.ts` and Node DSN in `instrument.mjs`.
  - Google Maps API key in `src/app/core/location-search.ts`.
  - Stripe webhook secret in `docker-compose.yml`.
- Type mismatch: `Express.Request.user` is declared required but is optional at runtime (`src/types/express/index.d.ts`).
- Broken route reference: guards redirect to `/404` but no route/component exists.
- Unit test vs. implementation mismatch in `registration-start-offset.pipe` (sign handling reversed).
- Security hardening: no `helmet`, `x-powered-by` enabled, and `trust proxy` not set (required behind Fly proxies).

### High-Impact Improvements
- Centralize runtime config (public + server) and remove all hard-coded secrets from code.
- Add 404/500 routes and unify SSR error handling.
- Add `helmet`, disable powered-by header, set `trust proxy`, and rate-limit sensitive routes (e.g., webhooks).
- Tighten CI gating (lint, build, e2e) before deploy.
- Tune Sentry sampling for production and keep devtools out of prod builds.

## Priority Roadmap

### Phase 1 — Pre‑Feature Foundation (Do now)
1) Secrets and Runtime Config
   - Move Sentry DSNs and Google Maps API key to env‑backed config; expose public settings via tRPC `config` or an injected config endpoint.
   - Remove `STRIPE_WEBHOOK_SECRET` from `docker-compose.yml`; rely on env files and GH actions secrets.
2) Security Hardening (Server)
   - Add `helmet` (CSP tuned for Angular SSR), disable `x-powered-by`, set `app.set('trust proxy', true)`.
   - Add basic rate limiting and size limits for `/webhooks/stripe` and other sensitive endpoints.
3) Routing/UX Resilience
   - Add `/404` and `/500` routes + components; wire SSR error handler to render 500 page.
   - Ensure guards and fallbacks navigate/render correctly under SSR.
4) Quick Correctness Fixes
   - Make `user` optional on `Express.Request` (`src/types/express/index.d.ts`).
   - Fix `registration-start-offset.pipe` logic to match spec.
   - Change `import { AppRouter }` to `import type { AppRouter }` in `src/app/app.config.ts` to ensure tree‑shaking friendliness.
   - Gate TanStack Query devtools behind an env/dev flag.
5) CI Quality Gates (Defer for now)
   - CI is secondary until E2E coverage is complete. Keep CI minimal and add gates later.

### Phase 2 — Pre‑Prod Hardening (After features are complete)
1) Observability and Ops
   - Lower Sentry traces/profiles sample rates in production; keep sourcemap upload conditional on token presence.
   - Add `/healthz` (and optionally `/readyz`) endpoints; configure Fly health checks.
   - Standardize logging (PII redaction, log level via env; align `CONSOLA_LEVEL`).
2) Data and Migrations
   - Adopt versioned, reviewable migrations for production (avoid `push` in prod); document migration/rollback runbook.
   - Verify connection pooling and Neon serverless limits; set sensible timeouts.
3) Testing & QA
   - Increase unit tests around guards, pipes, and core services (`ConfigService`, `PermissionsService`).
   - Add tests for 404/403 flows and SSR error rendering.
   - Consider performance tests for key pages and tRPC endpoints.
4) Security & Compliance
   - Finalize CSP (script/style nonces or hashes), Strict‑Transport‑Security, and standard security headers via `helmet`.
   - Review CSRF posture for any cookie‑authenticated mutations; add CSRF protection if applicable.
5) UX/SEO
   - Generate tenant‑aware `robots.txt` and `sitemap.xml` via server endpoints, using `request.tenant` and published content (e.g., visible events). Include caching and `lastmod` where possible. Remove static files once dynamic endpoints are live.
   - Add canonical + Open Graph/Twitter meta (SSR via `ConfigService`).
   - Use `NgOptimizedImage` for static assets where appropriate.
6) Documentation & Developer Experience
   - Replace CLI boilerplate `README.md` with project‑specific instructions (from `AGENTS.md`).
   - Add environment matrix and onboarding steps; document runtime config and secrets.

## Detailed Recommendations by Area

### Security & Secrets
- Remove all hard-coded secrets/keys from the repo (Sentry DSNs, Google Maps key, Stripe webhook secret).
- Provide a typed runtime config endpoint for the browser (public keys only) and read private values from server env.
- Add `helmet` with CSP tuned for Angular SSR + Material + Tailwind; disable `x-powered-by`; set `trust proxy` on Express.
- Add body size limits and rate limiting for webhooks and auth flows.

### SSR & Routing
- Add 404/500 routes; ensure SSR error handler renders 500 with appropriate status codes.
- Confirm cookie forwarding and tenant resolution are correct behind proxies.
- Keep `express.static` immutable caching as configured (1y) and ensure ETag support.

### Observability
- Tune Sentry sampling for prod (lower rates); guard Replay usage in prod.
- Keep sourcemap upload step conditional on token; store in CI secrets.

### Build & CI/CD
- For now, keep CI minimal; once E2E is mature, consider adding lint/build gates before deploy.
- Keep `@sentry/cli` and other build-time tools out of production image layers.

### Testing
- E2E (gate): add 404/403 and webhook flows (mocked). Keep axe a11y checks as acceptance gates.
- Unit: optional for now per owner preference; can be added later if priorities change.

### Data & Migrations
- Prefer versioned migrations over `push` in production. Document rollback.
- Validate Neon serverless usage for concurrency and latency; consider pooling if needed.

### UX/SEO
- Add `public/robots.txt` and sitemap; configure canonical URL and social meta tags.
- Use `NgOptimizedImage` for static assets and confirm link preloading where beneficial.

### Code Health
- Make `Express.Request.user` optional to match runtime behavior.
- Fix `registration-start-offset.pipe` sign handling.
- Type-only import for `AppRouter`; guard devtools for production builds.
- Replace Angular CLI boilerplate `README.md` with project docs aligned to `AGENTS.md`.

## Specific Quick Fixes (with references)
- Secrets in code
  - `src/main.ts` (Sentry browser DSN), `instrument.mjs` (Sentry node DSN), `src/app/core/location-search.ts` (Google Maps key).
  - `docker-compose.yml` includes `STRIPE_WEBHOOK_SECRET`.
- Type mismatch
  - `src/types/express/index.d.ts`: change `user: User` → `user?: User`.
- Broken route
  - `/404` referenced in guards but missing (e.g., `event-edit.guard.ts`).
- Pipe bug
  - `src/app/shared/pipes/registration-start-offset.pipe.ts` contradicts its spec; fix positive/negative handling.
- Server hardening
  - Add `helmet`, `app.disable('x-powered-by')`, and `app.set('trust proxy', true)` in `src/server/app.ts`.
- Client import hygiene
  - Use `import type { AppRouter }` in `src/app/app.config.ts`; gate TanStack Query devtools by env.

## Next Steps
- If desired, we can immediately:
  1) Extract secrets to env-driven config and wire a public runtime config endpoint.
  2) Add 404/500 routes and harden Express (helmet, trust proxy, headers).
  3) Fix the pipe and Express type; adjust `AppRouter` import and devtools guard.
  4) After E2E coverage is done, update CI to gate on lint/build/e2e before deploy.
