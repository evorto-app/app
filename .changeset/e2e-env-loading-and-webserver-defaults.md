---
default: patch
---

# Make local E2E configuration deterministic

- refresh the supported worktree-local `.env.dev` override before canonical Playwright commands,
- load developer secrets from `.env` without introducing alternate dotenv filenames, and
- default `NO_WEBSERVER` to `false` when it is unset so local commands start the tested application stack.
