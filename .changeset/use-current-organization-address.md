---
default: patch
---

Use the current Evorto address as the only ordinary way to select an
organization. Keep server rendering and local test routing separate and
tightly limited. Only people marked as platform administrators through the
current sign-in settings receive platform-wide access.

Reject raw paths and malformed separators in the configured internal RPC
origin before allowing server-rendered requests to select an organization.
