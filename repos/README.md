# Upstream reference sources

These are pristine source snapshots for local API and implementation research.
They are not installed dependencies and must not be imported by application code.

| Directory | Upstream release | Commit |
| --- | --- | --- |
| `effect/` | [effect@4.1.5](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.5) | `e3aca1f1484e623cee09b7f3fa18d6ff5d66c0e8` |
| `drizzle/` | [v1.0.0-rc.6](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.6) | `f163324decffcc67b47c6f3dda43ca7bb5aaec49` |

Refreshed on 2026-11-21 from the official GitHub source archives at these exact
commits. Preserve upstream contents and file modes; do not run the app formatter
or dependency installer inside these directories. Keep snapshot refreshes in
separate commits from application dependency and compatibility changes.
