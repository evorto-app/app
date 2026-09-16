---
default: patch
---

# Refresh supported dependencies and runtime tooling

Update compatible application dependencies, including Angular Material, Effect,
Stripe, React, Playwright, lint tooling, and CSS security fixes. Align local, CI,
and Docker tooling on Bun `1.4.2` and Node `24.21.0`; Angular CLI runs through Node.

Keep TypeScript 6 and Vitest 4 within Angular 22 support. Keep Effect at beta.103
because the current Drizzle release candidate still uses `Schema.TaggedErrorClass`,
removed in beta.104. Pin the shared Effect platform package to the same prerelease.

Patch the two Effect Angular wrappers' peer metadata to match the upstream Angular
22 declaration without changing their runtime code. Vendored reference sources are
unchanged by this update.

Align outgoing Stripe API requests with the SDK's `2026-08-26.dahlia` version,
a backward-compatible monthly update within the existing Dahlia release.
