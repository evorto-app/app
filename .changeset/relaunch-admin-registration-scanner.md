---
default: patch
---

# Tighten relaunch admin, registration, and scanner behavior

- add tenant-scoped existing-user role assignment behind `users:assignRoles`
- hide Scanner navigation unless the user can scan through permissions or an active organizing registration today
- expose manual approval as the supported non-FCFS registration mode while rejecting unsupported random allocation on write paths
- add tenant operations settings for email reply-to, Stripe account id, and active registration limits
- queue receipt and manual-approval notifications through a durable email outbox with global-admin visibility
- require the Resend API key at startup and send manual approval/receipt review emails from `ESN.WORLD <no-reply@notifications.esn.world>`
