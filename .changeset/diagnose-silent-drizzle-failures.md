---
default: patch
---

# Diagnose silent Drizzle schema failures

Retry failed, empty Drizzle JSON responses with a non-mutating text-mode
explain command so staging deployment logs retain a redacted database failure
category without exposing provider output.
