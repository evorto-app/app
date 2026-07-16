---
default: patch
---

# Return reviewed events to draft

- replace the stale durable rejected status with a return-to-draft transition,
- require and preserve reviewer feedback and reviewer audit fields on the draft,
- keep only drafts editable and eligible for review submission, and
- align event review actions, status copy, tests, and generated documentation
  with the draft, pending-review, and published lifecycle.
