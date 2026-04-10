---
evorto: patch
---

Improve local E2E test ergonomics and deterministic config loading:

- Automatically load `.env.development` whenever the file exists (no `LOAD_ENV_DEVELOPMENT=true` flag required).
- Remove `LOAD_ENV_DEVELOPMENT=true` from Playwright npm scripts.
- Default `NO_WEBSERVER` to `false` in Playwright environment validation when it is unset.
