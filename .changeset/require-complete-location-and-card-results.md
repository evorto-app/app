---
default: patch
---

Require complete Google Maps suggestions and ESNcard validity windows before saving provider results. Keep saved cards unchanged when validation is unavailable or the card changes during a check, and refresh the profile after a discarded check.

Discard a saved-card validation if its original identity changed during the
provider request. Clear prior metadata and validity dates when an authoritative
result omits them, while preserving the saved card on transport failure. Reject
blank returned Google place IDs and bound diagnostic reason scanning and queued
objects before traversing provider failures.
Reload the current saved card after a discarded save or refresh, preserving the
identifier draft and leaving provider-failure state unchanged.

Report concurrent ESNcard ownership and first-save conflicts as recoverable errors without overwriting the winning card. Keep diagnostic inspection bounded across prototype chains and safe when failure objects contain proxies.
