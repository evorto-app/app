---
default: patch
---

# Add measured indexes for the event, member and finance lists

- add concurrent, non-unique indexes on `event_instances (tenantId, end)`,
  `users_to_tenants (tenantId)` and `transactions (tenantId, createdAt)`,
- each one changes the measured `EXPLAIN ANALYZE` plan of the event list,
  member list or finance list on a seeded large-section database.
