---
default: patch
---

# Refresh the default look and shared controls

- refresh the Evorto theme with indigo, slate, orange, and warm-neutral colors while retaining the ESN theme,
- make shared role, location, icon, and rich-text controls clearer and more consistent, and
- preserve expected validation and registration messages while limiting issue reports to safe, bounded details,
- recover event review conflicts using typed outcomes, and
- apply the current theme and light/dark browser chrome colors during both browser and server initialization,
- preserve images in saved rich-text content when surrounding text is edited or formatted, and
- bound browser error telemetry across caller-controlled hosts with per-process and per-host quotas.

Preserve actionable onboarding and registration errors, reject inherited timezone keys, and verify selected roles before saving while keeping failed lookups removable and role search bounded.

Keep location selection tied to the latest request and preserve cancellation while the dialog closes. Preserve safe organizer, organization-settings, and tax-import guidance without exposing provider or internal errors.

Keep website address validation visible when creating or editing an
organization, while keeping unexpected errors out of user-facing messages.

Reject raw paths, backslashes, and embedded whitespace before URL normalization
when validating tenant domains or local development origins.

Browser telemetry uses one fixed 60-second quota window per web process: up to
100 admitted reports total and 10 per host, with deduplication in that window.
Host quotas and fingerprints expire together, so caller-controlled host keys
cannot retain the next window's budget. Each process retains at most 100 host
keys and 100 fingerprints. Multiple web instances have independent budgets,
and restarts reset them; these are not service-wide or rolling-minute limits.
Anonymous callers can consume the process budget, so this remains bounded,
best-effort diagnostics rather than a tenant-authenticated delivery guarantee.
