---
evorto: patch
---

# Recover email delivery after worker crashes

- lease each claimed outbox row and automatically reclaim expired or legacy `sending` rows,
- fence delivery completion by lease ownership so an older worker cannot overwrite a newer claim, and
- reuse the existing Resend idempotency key while recovering an interrupted delivery attempt.
