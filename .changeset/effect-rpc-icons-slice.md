---
evorto: patch
---

# Move icon selector APIs from tRPC to Effect RPC

Continue the tRPC decommission by migrating the icon domain to Effect RPC:

- add shared `icons.search` and `icons.add` Effect RPC contracts,
- implement authenticated icon handlers in the Effect RPC server layer,
- migrate icon selector client calls and query invalidation to Effect RPC helpers/client,
- remove `icons` from the tRPC app router surface and delete the unused tRPC icons router.
