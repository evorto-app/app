---
evorto: patch
---

# Stabilize Bun template flows and docs e2e reliability

Finalize Bun-first migration quality gates by:

- removing transaction-only template simple create/update writes that failed on Neon local websocket transaction paths under Bun,
- persisting template `location` consistently across create and update inputs in the simple template router,
- tightening docs test selectors/navigation for profile discounts and event approval workflows,
- reducing template e2e data collisions by generating unique template titles per run,
- validating final Bun gates end-to-end (`lint`, `build`, `test`, `e2e`, and `e2e:docs`).
