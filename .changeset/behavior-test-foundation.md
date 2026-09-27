---
default: patch
---

Verify transaction, tenant, payment and recovery invariants through application
and PostgreSQL behavior. Replace schema/source metadata assertions and enforce
important structural constraints with ESLint. Exercise the production request
adapter, refund interruption handling and Docker build-context exclusions.

Preserve unexpected refund defects and cancellation while expected refund
failures remain queued for recovery. Require explicit PostgreSQL table names.
