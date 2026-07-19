---
default: patch
---

# Enforce complete pull request quality gates

Require lint, both unit suites, the application build, Knope validation, the
dedicated PostgreSQL 17 integration suite, and every applicable Playwright
baseline to pass completely on a developer machine before any push, pull-request
update, or CI-triggering action. Vitest and Playwright now reject skipped, todo,
fixme, expected-failure, interrupted, focused, retried, or flaky outcomes;
missing disposable-database configuration fails loudly, and CI only confirms an
already-green local result. GitHub release publication also waits for successful
PR Quality and E2E Baseline main-push runs for the exact release merge commit.
CI provisions Chromium for browser-backed security unit tests and Bun for the
runtime-image verification step instead of relying on runner-global tools.
