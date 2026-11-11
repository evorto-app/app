---
default: patch
---

# Require a template permission to list template categories

- `templateCategories.findMany` now requires `templates:view`, `templates:create`, `templates:editAll` or `templates:manageCategories` (including permissions that imply them),
- anonymous callers get an unauthorized error and signed-in users without any of these permissions get a forbidden error instead of the tenant's category list.
