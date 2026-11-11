---
default: patch
---

# Require a template permission to list template categories

- template creation, editing and category management now automatically grant template viewing, so these roles can load the pages and category choices their work requires without separately granting viewing,
- `templateCategories.findMany` requires template viewing, including access through the shared permission dependencies; anonymous callers get an unauthorized error and callers without access get a forbidden error before categories are read,
- implied viewing does not grant additional permission to create, edit or delete templates or manage their categories.
