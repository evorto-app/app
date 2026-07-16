---
default: patch
---

# Align Playwright tests with new structure and linting

- migrate Playwright tests to `tests/**` (docs in `tests/docs/**`) and retire legacy `e2e/` layout,
- enforce required `@track`, `@req`, and `@doc` tags via ESLint for Playwright tests,
- update documentation, configs, and tooling references to the new test structure,
- require every collected functional and documentation test to pass without skips, fixmes, retries, flakes, or other incomplete outcomes.
