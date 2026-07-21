---
default: patch
---

# Fix anonymous authenticated-route deep links

Redirect first-time anonymous visitors from protected staging links into Auth0
instead of returning the unknown-organization page when Angular cancels its
initial server-side navigation.
