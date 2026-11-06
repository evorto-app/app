---
default: patch
---

# Remove duplicate database error compatibility code

Use one database constraint classifier for registrations, transfers, role names, tenant domains, and discount cards. Remove the unused active-registration classifier and duplicate constraint names, using the identifiers exported by the schema instead. Preserve defects and interruptions rather than misclassifying combined causes as recoverable conflicts.
