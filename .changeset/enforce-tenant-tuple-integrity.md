---
default: patch
---

# Enforce tenant identity across role assignments and registrations

- bind every role assignment to the shared tenant of its role and membership,
- reject registrations whose event belongs to another tenant, and
- reject registrations whose selected option belongs to another event.
