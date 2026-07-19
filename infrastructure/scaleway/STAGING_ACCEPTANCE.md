# Scaleway Staging Acceptance

Use this checklist only against `https://staging.evorto.app` with seeded/test
data, Stripe test mode, the protected email allowlist, and the exact successful
deployment manifest under review. Keep browser screenshots, console/network
exports, provider evidence, and drill records private when they contain user or
operational data.

## Release identity and platform

- [ ] The immutable staging manifest says `status: succeeded` and records the
      expected full commit, digest, schema hash, workflow run, source-map key,
      SBOM key, and timestamp.
- [ ] `/version` is `no-store` and exactly matches the manifest environment,
      revision, and digest.
- [ ] web and worker use the same digest; ops used that digest for the schema
      plan.
- [ ] `/healthz` is DB-free and healthy.
- [ ] `/readyz` proves behavioral SSR against `staging.evorto.app`, independent
      of the generated container hostname.
- [ ] The staging hostname resolves through the retained DNS provider, the
      generated hostname is not treated as a tenant, and `X-Forwarded-Host`
      cannot select another tenant.
- [ ] Responses carry `X-Robots-Tag: noindex, nofollow`; rendered pages also
      remain excluded from indexing.
- [ ] PostgreSQL is private-only, TLS verification succeeds, runtime/schema
      users are distinct, and observed pool usage stays inside configured
      bounds.
- [ ] Cockpit receives structured logs and traces with environment, role,
      revision, digest, request ID, and no secrets or unredacted browser-error
      payloads.
- [ ] 5xx/readiness, restart, worker/ops, database, storage/CPU, and billing
      alerts have been test-fired or otherwise proven deliverable.

## Browser walkthrough

Open DevTools before each journey. Treat console errors, failed requests,
unexpected redirects, hydration errors, cross-origin warnings, and CSP/CORS
failures as defects even when the final screen looks correct.

- [ ] Anonymous event listing/detail and unknown-tenant behavior.
- [ ] Account sign-in, sign-out, callback, session renewal, and Auth0 error
      handling.
- [ ] Free registration, included/free add-ons, guest quantities, and ticket.
- [ ] Paid registration in Stripe test mode, webhook settlement, receipt, and
      independently priced post-registration add-on purchase.
- [ ] Capacity boundary, waitlist entry, availability notification, and claim.
- [ ] Cancellation with no refund and with exact Stripe refund lifecycle.
- [ ] Transfer of the inseparable registration/add-on/fulfillment bundle,
      including recipient discount repricing and source exact refunds.
- [ ] Organizer event create/edit/review/publish, attendee operations, check-in,
      add-on fulfillment, receipt review, and reimbursement recording.
- [ ] Tenant role/user/settings/branding/legal/Stripe administration.
- [ ] Platform tenant, event, template, user, finance, scanner, and audit
      operations without requiring tenant membership.
- [ ] Receipt JPEG, PNG, WebP, and PDF upload/preview/consume paths through the
      signed POST flow.
- [ ] Google Maps location search and persisted location rendering.
- [ ] ESNcard active and permanently expired provider journeys using only
      protected identifiers.

For scanner acceptance, prefer the deterministic registration-result URL. Use
camera emulation only if it is reliable on the test machine; unreliable camera
faking is not acceptance evidence. Manually inspect permission/error behavior
and the result transition either way.

## Worker and provider behavior

- [ ] Each CRON invokes only its documented private path with bounded JSON.
- [ ] Concurrent/repeated worker calls settle idempotently and do not duplicate
      email, refunds, checkout cleanup, or orphan deletion.
- [ ] TEM sends only to the staging allowlist from
      `Evorto <no-reply@notifications.evorto.app>` and preserves tenant
      Reply-To.
- [ ] A recipient outside the allowlist becomes terminal `suppressed` without a
      provider request.
- [ ] Explicit retryable provider failures back off; an ambiguous
      post-dispatch failure becomes terminal `deliveryUnknown`; exhausted and
      unknown rows remain read-only.
- [ ] Signed receipt policies expire after five minutes, bind exact key/type/
      size, reject wrong tenant/user/event, MIME spoofing, oversize and public
      ACL, promote the validated bytes to a server-only content-addressed key,
      remain unchanged after the browser upload policy is reused, and tolerate
      concurrent finalize calls atomically without retaining a losing promoted
      object.
- [ ] The orphan worker removes only expired unconsumed objects after the safety
      grace period.

## Resilience evidence

- [ ] A backup restored into a separate temporary private PostgreSQL instance;
      restoration duration and data/schema verification were recorded.
- [ ] A controlled harmless drift was reconciled without changing the accepted
      image digest; the following Terraform plan was clean apart from ignored
      deployment-owned fields.
- [ ] A failed post-traffic release restored web and worker to the prior image
      digest; health/readiness/version/SSR/RPC passed afterward.
- [ ] Runtime image inspection found no secrets, private source maps, Sentry,
      Neon, Resend, R2-specific, or Cloudflare Images runtime dependency.
- [ ] Private source maps and the SBOM exist at manifest keys and inherit the
      documented retention/lifecycle rules.
- [ ] The clean 11-test provider suite and live ESNcard release certification
      passed locally with zero failures, skips, todos, expected failures,
      retries/flakes, interruptions, or focused tests before the deploy run.

## Acceptance record

```text
Revision:
Image digest:
Schema hash:
Deployment manifest key:
Deployment workflow URL:
Browser evidence location:
Provider evidence location:
Restore evidence key and measured duration:
Drift evidence key:
Rollback evidence key:
Accepted by:
Accepted at:
Open defects or explicit blockers:
```

Production remains disabled after this checklist. Enabling it requires a
separate decision, protected-environment approval, and an accepted staging
manifest; this document does not authorize provisioning production resources
or directing production traffic.
