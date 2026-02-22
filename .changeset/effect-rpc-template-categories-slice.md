---
evorto: patch
---

# Move template category APIs from tRPC to Effect RPC

Continue the tRPC decommission by migrating the template category domain to Effect RPC:

- add shared `templateCategories.findMany`, `templateCategories.create`, and `templateCategories.update` Effect RPC contracts,
- implement authenticated/permissioned template category handlers in the Effect RPC server layer,
- migrate template category query/mutation callsites to Effect RPC helpers/client,
- remove `templateCategories` from the tRPC app router surface and delete the obsolete tRPC template category router.
