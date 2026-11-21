---
default: patch
---

Add `bun run docker:start:walkthrough`, which resets the local Docker stack
with seed dates from today and an unpinned web and worker clock, so a fresh
manual walkthrough shows upcoming events. `docker:start` keeps the fixed test
clock and now prints the pinned date with a pointer to the walkthrough start
(EVO-20).
