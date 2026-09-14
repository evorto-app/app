---
default: patch
---

# Refresh dependency and vendored upstream baselines

Update the root dependency set across Angular, Effect, Drizzle, Stripe,
Cloudflare, Sentry, Tiptap, Playwright, Tailwind/PostCSS, ESLint, Prettier, and
type packages.

- align vendored `repos/effect` with Effect `4.0.0-beta.92`,
- align vendored `repos/drizzle` with Drizzle `1.0.0-rc.4`,
- update the Bun toolchain references to `1.3.14`,
- run Angular CLI package scripts through Node `24.15.0` locally, in CI, and in
  Docker; retain Bun `1.3.14` for package management and the application runtime.
