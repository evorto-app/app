---
default: patch
---

# Target announcement discovery by organization role

Let optionless announcements select explicit organization roles for ordinary
event discovery. Empty selections stay link-only, while direct-link access,
permissions, and notification recipients remain independent.

The ordinary editor keeps Save disabled until the role catalog proves the
selection valid and surfaces update failures instead of closing on stale state.
