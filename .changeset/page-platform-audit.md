---
default: patch
---

Replace the platform audit log's hard result cap with deterministic 50-entry
keyset pages and an explicit Load older flow.

Show safe actor, tenant, resource, and permission-change evidence while keeping
raw errors and provider payloads out of the operator view.
