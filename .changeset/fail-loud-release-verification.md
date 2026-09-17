---
default: patch
---

Stop releases when required safety checks are missing, out of date, or
unsuccessful. Failed test data is no longer included in release packages.

Validate production enablement after protected-environment approval, and fail
visibly before deployment commands unless its environment flag is exactly true.
