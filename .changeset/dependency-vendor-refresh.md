---
default: patch
---

# Refresh dependency and vendored upstream baselines

Update the root dependency set across Angular, Effect, Drizzle, Stripe,
Cloudflare, Sentry, Tiptap, Playwright, Tailwind/PostCSS, ESLint, Prettier, and
type packages.

- align vendored `repos/effect` with Effect `4.0.0-beta.92`,
- align vendored `repos/drizzle` with Drizzle `1.0.0-rc.4`,
- update the Bun toolchain references to `1.4.2`,
- run Angular CLI package scripts through Node `24.21.0` locally, in CI, and in
  Docker; retain Bun `1.4.2` for package management and the application runtime.

Refresh supported dependencies with aligned Effect beta.103, Angular Material 22.1.6, Playwright 1.63, and current compatible tooling. Keep TypeScript 6 and Vitest 4 within Angular 22 support. Patch the two Effect Angular wrappers’ peer metadata to match the upstream Angular 22 declaration without changing their runtime code.

Keep Effect at beta.103 while the current Drizzle release candidate still uses `Schema.TaggedErrorClass`, removed in beta.104. Pin the shared Effect platform dependency to the same prerelease.

Align outgoing Stripe API requests with the SDK's `2026-08-26.dahlia` version, a backward-compatible monthly update within the existing Dahlia release.
