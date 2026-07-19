---
default: patch
---

# Fix Scaleway private database deployment output

Use the private database endpoint IP when constructing role-scoped database
secrets because Scaleway private RDB endpoints do not provide a hostname.
