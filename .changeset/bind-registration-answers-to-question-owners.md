---
default: patch
---

Bind saved registration answers to the same event, registration option, and tenant as their registration and question. Preserve questions with saved registration or transfer answers when organizers edit an event.

Serialize event-question edits with registration, waitlist, and transfer answer validation so concurrent writes cannot delete history or accept outdated required-question sets. Reject nonzero prices on free graph options before persistence, and index transfer answers by question for bounded history checks.
