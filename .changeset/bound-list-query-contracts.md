---
default: patch
---

Validate event-list page offsets, require canonical timestamps, and show at most 100 events per page. Load more events without losing earlier pages.

Wait for event results or an explicit error before completing server rendering, so initial HTML does not retain a loading message after the request has finished.
