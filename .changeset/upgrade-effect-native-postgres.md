---
default: patch
---

# Update Effect and preserve PostgreSQL connection safety

Update the coordinated Effect RC, Vitest and Angular build-tool cohort. Preserve strict settings validation, database socket paths, TLS identity checks and timestamp precision with the native PostgreSQL driver. Reject unsupported SSL URL options explicitly. Discard canceled PostgreSQL sessions before reuse, including held and transaction-pinned connections, and cover native cancellation ownership with protocol-level tests.
