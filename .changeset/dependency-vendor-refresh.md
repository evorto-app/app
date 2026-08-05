---
default: patch
---

# Refresh dependency and vendored upstream baselines

Update the root dependency set across Angular, Effect, Drizzle, Stripe,
Cloudflare, Sentry, Tiptap, Playwright, Tailwind/PostCSS, ESLint, Prettier, and
type packages.

- align vendored `repos/drizzle` with Drizzle `1.0.0-rc.4`,
- update the Bun toolchain references to `1.3.14`,
- temporarily run Angular CLI package scripts under Bun with explicit Node
  `24.15.0` compatibility defines until a stable Bun release reports a version
  accepted by Angular 22.
