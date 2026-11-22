---
default: patch
---

# Update Drizzle, Effect, vendored snapshots, and dependencies

Refresh vendored upstream reference snapshots to Effect 4.1.5 and Drizzle
1.0.0-rc.6, migrate the application to Drizzle 1.0.0-rc.6, Effect 4.1.5,
Angular 22.3.0, and compatible updated dependencies, drop obsolete
`@heddendorp/effect-*` Angular 22 patches, rebase the `@effect/sql-pg`
cancellation patch onto 4.1.5, and configure Dependabot with a 7-day cooldown
and grouped updates.
