---
evorto: patch
---

# Move templates grouped-by-category reads from tRPC to Effect RPC

Continue the template-domain cutover by migrating grouped template-list reads to Effect RPC:

- add shared `templates.groupedByCategory` Effect RPC contract and typed response schema,
- implement tenant-scoped grouped template read handler in the Effect RPC server layer,
- migrate template list and category list query callsites to Effect RPC helpers,
- update create/edit invalidations to target Effect RPC query keys for grouped templates,
- remove `templates.groupedByCategory` from the tRPC template router.
