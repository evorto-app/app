# Upstream reference sources

These are pristine source snapshots for local API and implementation research.
They are not installed dependencies and must not be imported by application code.

| Directory | Upstream release | Commit |
| --- | --- | --- |
| `effect/` | [effect@4.0.6](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.6) | `3b28bf686bf26e9700edd39c025aff2744dc5303` |
| `drizzle/` | [v1.0.0-rc.5](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.5) | `5d71fc408add08bd207f4753f4554578ec9e0640` |

Refreshed on 2026-10-23 from the official GitHub source archives at these exact
commits. Preserve upstream contents and file modes; do not run the app formatter
or dependency installer inside these directories. Keep snapshot refreshes in
separate commits from application dependency and compatibility changes.
