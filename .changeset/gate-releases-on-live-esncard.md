---
default: patch
---

# Gate repository releases on live ESNcard certification

Require protected active and permanently expired non-production ESNcard
identities to pass live add, refresh, remove, expired-state, and provider-error
UI verification before a repository release can be published. Knope Bot keeps
version and changelog preparation reviewable in its release pull request and
creates a draft GitHub release; after merge, automation verifies that the draft
tag targets that exact merge and publishes it only after provider certification.
Deployment orchestration is intentionally left to its separate change.
