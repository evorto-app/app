---
evorto: patch
---

# Enforce complete pull request quality gates

Require lint, both unit suites, the application build, Knope validation, the
dedicated PostgreSQL 17 integration suite, and every applicable Playwright
baseline to pass completely on a developer machine before any push, pull-request
update, or CI-triggering action. Vitest and Playwright now reject skipped, todo,
fixme, expected-failure, interrupted, focused, retried, or flaky outcomes;
missing disposable-database configuration fails loudly, and CI only confirms an
already-green local result.
