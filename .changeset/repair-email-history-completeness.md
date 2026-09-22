---
default: patch
---

Show confirmed sent email history as complete when its sent time is recorded. Keep sent records with a missing sent time marked for attention, without offering a resend action.

Prioritize incomplete sending, sent, and suppressed diagnostics alongside failed
and uncertain deliveries, ahead of ordinary retained history. Keep each overview
candidate bucket bounded and index incomplete terminal records separately.
Normal delivery writers continue recording terminal timestamps atomically;
these diagnostics cover degraded records and never offer or schedule a resend.
