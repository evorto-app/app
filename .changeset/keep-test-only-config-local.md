---
default: patch
---

# Keep test-only configuration local

- honor `E2E_NOW_ISO`, `E2E_RUNTIME_MODE` and `TENANT_DOMAIN` only when `APP_ENVIRONMENT=local`,
- ignore them on staging and production (real clock, normal configuration) and log a misconfiguration error at startup without failing,
- stop parsing the Playwright test configuration in the application runtime config.
