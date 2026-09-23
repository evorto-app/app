---
default: patch
---

Save one ESNcard on a member's account and share it across their organizations.
Each organization still decides whether to offer ESNcard discounts. Explain
that changing or removing the card affects future discounts everywhere while
preserving prices already recorded for registrations and payments.

Recheck current card eligibility when registrations, approvals, and transfers
commit. Keep late provider responses from overwriting a replacement card, and
restore the exact original account state after shared browser tests.

Card storage now uses global account and identifier uniqueness. The relaunch
schema and application must be applied together; transferring legacy data is
separate work and this change adds no incremental migration.
