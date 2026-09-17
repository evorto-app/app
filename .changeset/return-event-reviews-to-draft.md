---
default: patch
---

# Return events to draft after review

Use consistent "Return to draft" wording in the review queue, feedback dialog,
and event approval guide. Explain why an event can no longer be reviewed or
submitted.

Keep review and submission actions busy until their follow-up reads settle.
Distinguish uncertain responses from confirmed changes whose updated details
could not be loaded, and retain feedback when a reviewer reopens the dialog.

Keep feedback when reopening a review from the admin queue, and distinguish an
uncertain response from a confirmed decision whose follow-up reads failed.
Describe refresh failures without incorrectly claiming the event detail failed.
Keep previously loaded event pages visible with an explicit refresh warning and
retry when a background reload fails.
