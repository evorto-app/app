---
default: patch
---

Replace implementation wording in the application with plain descriptions of
what happened and what the person can do next. Keep unexpected failures visible
while retaining technical diagnostics only in logs and executable checks.

Documentation publication retains both errors when publishing and temporary-file
cleanup fail together, while continuing to report a cleanup failure on its own.

Receipt-load failures explicitly leave the current list unconfirmed and ask
organizers to retry before adding another receipt. Documentation screenshots
wait for visible compound loading messages and indeterminate loading indicators,
while allowing hidden states and settled content.
