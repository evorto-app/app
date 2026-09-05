---
default: patch
---

Remove the unsupported random allocation mode from the registration schema, API records, and event/template editors. First come, first served and Manual approval retain their existing behavior. Apply this as part of the coordinated fresh-schema relaunch; existing random rows must not be silently converted to another mode.
