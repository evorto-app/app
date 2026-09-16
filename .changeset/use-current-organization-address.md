---
default: patch
---

Use the current Evorto address as the only ordinary way to select an
organization. Keep server rendering and local test routing separate and
tightly limited. Only people marked as platform administrators through the
current sign-in settings receive platform-wide access.

Reject raw paths and malformed separators in the configured internal RPC
origin before allowing server-rendered requests to select an organization.

Require a server-issued ephemeral capability for internal SSR tenant routing and
cookie-origin exemptions, keep that capability out of serialized context, and
advertise tenant-specific robots and sitemap URLs from normalized request origins.
Dispose unsupported Bun request bodies and Node GET/HEAD uploads without waiting
for EOF, and reject unrecognized Playwright storage-state documents.
