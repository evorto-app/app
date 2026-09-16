---
default: patch
---

# Keep sample data setup reliable

Stop clearly when required organization details are missing or inconsistent,
instead of leaving partial or misleading sample data.

Require the staging ops Stripe test account in its protected secret contract
and validate seed configuration before initialization or destructive reset.

Require an explicit local database name and match the PostgreSQL driver target before reset or schema operations. Pass the same name into Compose database setup so missing or mismatched targets fail before connecting.

Fail when a declared sample add-on or registration question cannot resolve its
required template or registration option, rather than omitting it from the seed.

Show the bounded staging seed configuration diagnostic when a private ops call fails, while keeping unknown or internal response details private.

Validate pinned seed dates before connecting or beginning a reset, and reject invalid supplied dates before the seed transaction starts.

Run seed configuration preflight before Compose database setup resets or reapplies the schema.
