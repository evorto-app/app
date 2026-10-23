---
default: patch
---

# Update runtime and development dependencies

Update Angular 22.2, Effect 4.0.6, Drizzle rc.5, authentication, sanitization, editor, and test dependencies. Migrate Effect's stable import paths, retain PostgreSQL cancellation safeguards, and remove the obsolete Drizzle compatibility patch. Resolve audited Angular SSR and development-tool dependency vulnerabilities.

Align local and CI tooling on Node 24.22.1 while retaining the verified Bun 1.4.2 runtime, including immutable Node and refreshed distroless container image digests. Keep role-array predicates explicitly typed for PostgreSQL under the updated driver.

Keep mobile navigation above sticky event-list headings so returning to Events remains clickable after ticket changes.
