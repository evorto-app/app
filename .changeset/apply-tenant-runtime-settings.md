---
default: patch
---

# Apply tenant runtime settings consistently

- fix application and Material formatting to `de-DE` while removing locale from tenant-admin writes,
- apply tenant currency and IANA timezone defaults consistently in SSR, browser rendering, date inputs, and event-day grouping,
- preserve stored event instants and transaction currencies while keeping post-data currency/timezone edits locked.
