---
default: patch
---

Require HTTPS sign-in issuer addresses on the default port. Reject blank database
CA settings and connection URL options that override explicit TLS verification.
Attempt to restore original test-account access after uncertain administrator
setup failures, and report restoration failures explicitly.
