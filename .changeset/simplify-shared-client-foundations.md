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

Limit role searches to 64 characters and reuse recently verified role lookup results without repeating one request per known selected role. Keep stale, failed, or missing selections subject to verification and removal before saving.

Keep selected roles unverified while a required lookup is running, retaining their labels and removal controls. Reuse successful per-role checks for 30 seconds from their original verification time.

Remove URL usernames and passwords before browser telemetry is fingerprinted or
logged, including encoded credentials in the report URL, message, name, or stack.
Keep useful host/path details and the existing query/fragment redaction.

Reject raw paths and malformed separators in the internal SSR RPC origin before accepting the normalized loopback address.

Apply the same telemetry redaction before client logging and transmission, and retain server-side sanitization for directly submitted reports.

Recheck selected roles when their cached verification expires while a form stays open. Keep saving blocked until that check succeeds, while preserving removal and manual retry after failures.

Validate platform template role selections against the target organization before saving, including pending, failed, and missing role lookups. Preserve unavailable selections so they can be removed.

Omit oversized diagnostic fields before parsing or redaction, keeping browser error handling responsive without exposing a truncated credential prefix.

Redact registration-transfer credentials in page URLs and diagnostic text before
logging or serialization, including encoded routes and credentials.

Refresh event details and review lists when an event disappears during approval.
Keep icon selection responsive to its dialog width, render one role icon, and
reject malformed HTTP origin syntax before URL normalization.

Use one visible Edit button for rich-text previews, keeping saved links outside interactive button semantics.

Keep initialized platform template forms visible during role lookup failures and retries. Retain cached or saved role labels for removal, and block saving until target roles are verified.

Reject explicit empty ports in organization, development, and internal SSR origins before URL normalization.
