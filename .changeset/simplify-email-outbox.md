---
default: patch
---

Keep older email-delivery incidents ahead of newer routine outbox traffic in
the bounded platform overview.

Remove unused persisted sender copies and the one-method Angular forwarding
service. The delivery integration remains the single source of the
transactional sender, while tenant reply-to values stay on each message.
