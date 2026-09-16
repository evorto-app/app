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

Preserve explicit empty process and dotenv values until runtime configuration
validation. Reject an empty supplied database CA even when TLS is optional, and
never replace an empty higher-priority setting with a lower-priority value.

Require Members Hub permission before reading its roles and member names through
RPC, matching the protected page instead of allowing every signed-in account.

Preserve PostgreSQL raw Unix socket paths for connections without a configured
CA, while retaining IPv6 URL normalization and strict verified-TLS identity
validation. Other malformed non-URL connection strings remain rejected.

Recover invalid decoded sign-in sessions with a non-cacheable sign-in response
and expire only their session cookies. Keep unexpected identity-provider failures
on the existing server-error path.

Validate decoded session containers and primary token-set shapes before reading
them, so malformed stored values receive the same explicit sign-in recovery.
Use the effective PostgreSQL query host even without a URL authority, and reject
Unix-socket hosts whenever a CA is supplied, including explicit TLS-name overrides.

Recover unreadable session cookies even when the identity SDK returns no session. Keep absent cookies anonymous and preserve unrelated cookie names, including names that share the session prefix.
