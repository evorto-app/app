---
default: patch
---

# Normalize Scaleway Secret Manager IDs for deployment

Expose bare Secret Manager UUIDs to the deployment scripts because the
Scaleway CLI accepts the region separately from each secret identifier.
