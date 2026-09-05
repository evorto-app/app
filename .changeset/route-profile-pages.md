---
default: patch
---

# Split profile concerns into focused pages

Keep the familiar profile navigation while giving sign-ups, discount cards,
and submitted receipts their own pages. The account overview shows contact,
home-organization, and reimbursement readiness without exposing full bank
details. Event add-on summaries use the recorded organization currency and
charge only purchased extras. On small screens, moving between sections focuses
the page heading and preserves clear spacing.

Explain how to reload current cards after a confirmed ESNcard change is followed
by a failed card-list update.

Keep profile fields and reimbursement hints readable in the edit dialog. Offer
a read-only retry when profile information cannot be loaded, and wait for the
profile to be ready before capturing its guide. Block further ESNcard changes
after an unconfirmed result until an explicit read loads the current saved
cards. Keep the Use transfer code action and guide aligned.

Use clearer account setup labels and guidance for email verification, failed
reads, and changed joining requirements. Normalize the email for updates
consistently during account creation and profile editing. After completing
setup, refresh access with a full navigation and return to the originating
local page, including New member setup for the publishing administrator.
Use the profile when there is no valid local return destination.
