---
default: patch
---

# Keep template registration windows on the same clock time across DST changes

- count whole days of a template's registration open and close offsets as calendar days in the organization's time zone, so "7 days before" an event at 19:00 still opens at 19:00 when the clocks change in between,
- keep the remaining hours of an offset as elapsed time and leave stored offsets and existing events unchanged,
- apply the same rule in the template event form and in platform event creation.
