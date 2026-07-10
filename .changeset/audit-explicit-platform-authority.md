---
evorto: patch
---

Represent platform administrators as explicit Auth0-backed principals, keep their authority separate from tenant roles, and add target-scoped platform operations for tenants, attributed full-graph event and template management, registration approval/cancellation/check-in, user roles, finance and refund recovery, and tax administration. Supported registration modes remain first-come-first-served and manual approval; legacy random-allocation records stay readable but cannot be persisted by platform create or update operations. Registration inspection accepts a deterministic ticket-result URL and bounds PII-bearing lists to 100 records. Every platform mutation requires an operator reason and commits a typed, PII-free before/after audit entry alongside the domain change without inventing a tenant user.
