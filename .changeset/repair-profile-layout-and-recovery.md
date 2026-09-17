---
default: patch
---

Keep profile fields and reimbursement hints readable in the edit dialog. Offer a read-only retry when profile information cannot be loaded and wait for the profile to be ready before capturing its guide. Block further ESNcard changes after an unconfirmed result until an explicit read loads the current saved cards.

Keep card changes locked after a known card-change or missing-card rejection when
its follow-up read fails. Preserve the entered card number and the known rejection
until a successful explicit read restores the current card list. Offer an explicit
retry for failed receipt reads and use "Email for updates" consistently in account
and profile validation messages.
