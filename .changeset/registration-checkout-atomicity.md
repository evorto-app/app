---
default: patch
---

Keep paid registration and add-on reservations attached to one immutable Checkout claim. Validate provider identities before binding, reconcile ambiguous binding acknowledgements, and retain uncertain attempts for organizer review. Bind paid manual approval with its notification atomically, preserve settled price snapshots, and prevent duplicate capacity release when payment completion or expiry is replayed.

Paid sign-up completion checks saved answers against the currently locked questions. If required answers are no longer complete, it records the captured payment and cancels the pending sign-up with a durable full refund claim, rather than confirming it or leaving its payment unresolved. Replayed completion preserves the same refund and capacity release. Generic approval failures explain that the result needs checking without assuming payment setup is at fault.
