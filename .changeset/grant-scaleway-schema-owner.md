---
default: patch
---

# Grant the Scaleway schema owner database access

Grant the deployment-only schema owner explicit access to create and update
objects in the managed application database while retaining the separate
read/write-only runtime role.
