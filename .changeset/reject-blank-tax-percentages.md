---
default: patch
---

Reject tax rates with empty or whitespace-only percentages in paid template validation, selectable rate catalogs, and registration checks. Selected paid add-ons report their unavailable tax details before starting a sign-up or payment. Existing selections remain visible as unavailable until an organizer chooses a usable rate; valid zero-percent rates remain supported.
