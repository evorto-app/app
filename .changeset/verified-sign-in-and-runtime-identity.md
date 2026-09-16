---
default: patch
---

Require complete sign-in settings and sessions. Keep administrator access tied
to the verified administrator claim, refresh access after account setup, and
show incomplete sign-in details as a failure instead of treating them as a
signed-out session.

Require an explicit deployment environment, application role, worker trigger,
and database TLS choice. Authenticated tests require a preconfigured dedicated
administrator account without changing its shared claim during overlapping runs.

Reject blank required database certificates and verify the effective IPv6 connection host while preserving explicit server identities and strict TLS validation.

Reject auth origins whose raw paths, dot segments, empty query/fragment markers,
backslashes, credentials, or internal whitespace would disappear during URL
normalization. Preserve valid default ports, IPv6 origins, and local loopback
base URLs while retaining typed configuration failures.

Use the effective PostgreSQL host query value for managed schema connections
and certificate identity. Reject a supplied blank CA before any raw ops entrypoint
connects, including when verified TLS is optional, without trimming valid PEM.
Recover missing sign-in transactions with the same explicit callback failure
response while retaining unexpected SDK failures as defects.

Use a supplied CA for managed schema operations even when TLS is optional, and
normalize IPv6 certificate identities before verification or SNI. Keep effective
connection hosts, port/user/password overrides, and database pathname decoding
consistent with the pinned PostgreSQL driver. Managed URLs with a CA now reject
unsupported query settings instead of silently dropping them; URL credentials
remain explicit, with no ambient PostgreSQL credential fallback.

Reject malformed or non-IPv6 bracketed TLS identities instead of repairing them
into DNS names. Keep authentication configuration consistent with client origin
validation by rejecting explicit empty ports while preserving supported ports.

Apply the application's optional TLS server-name normalization to raw schema,
prerequisite, and reset settings: trim surrounding whitespace and verify the
connection host when the setting is blank, without weakening certificate checks.
