# Scaleway Hosting

## Current staging-only operation

`main` runs PR Quality and E2E Baseline automatically. When both pass for the
current commit, `Deploy Scaleway staging` builds or reuses one image and deploys
ops, worker and web at that digest. Routine tests and staging releases require
no approval click. Production is not provisioned.

Application deployments do not run Terraform, edit DNS, or read Terraform state.
They load an immutable, private configuration snapshot from the staging metadata
bucket. Infrastructure changes remain a separate operator task: review the
plan, apply it explicitly, verify it, then publish an updated configuration
snapshot. App deployments therefore do not detect unrelated Terraform drift.
Keep drift inspection in the infrastructure maintenance process.

The live infrastructure still uses `evorto/platform.tfstate` in its existing
state bucket. The checked-in `bootstrap`, `staging`, and `production` Terraform
roots describe a proposed split that has **not** been applied. Do not point a
new root at the existing state, apply the proposed bootstrap, or provision
production to restore application delivery. State migration and any future
production setup require their own reviewed plan.

The application remains the authorization boundary. PostgreSQL is private and
uses separate runtime and schema users. Stripe uses test mode; staging email
is restricted to the configured allowlist.

## GitHub environments

- `e2e-baseline`: routine browser-test credentials, restricted to `main`, without
  required reviewers or a wait timer. The workflow also checks protected-main
  provenance before starting the credential-backed job.
- `scaleway-staging`: staging deployment credentials and configuration, restricted
  to protected branches and without a required reviewer.
- `scaleway-staging-reset`: approval for destructive reset and reseed.
- `esncard-release-certification`: the separate live-provider certification
  workflow and its existing credential approval boundary.

The baseline environment needs the credentials validated by
`.github/workflows/e2e-baseline.yml`, plus `ISSUER_BASE_URL` and
`STRIPE_TEST_ACCOUNT_ID`. Use the dedicated test accounts and test-mode Stripe
credentials. It does not receive Scaleway credentials or live ESNcard identifiers.

The staging environment needs these variables:

- `SCW_ORGANIZATION_ID`, `SCW_PROJECT_ID`, and `BUCKET_SUFFIX` for existing staging;
- `STAGING_CONFIGURATION_KEY`, matching
  `configuration/staging/<sha256>.json` in the private deployment metadata bucket;
- the approved `STRIPE_TEST_ACCOUNT_ID` (also available as a repository variable).

Its secrets are `SCW_ACCESS_KEY`, `SCW_SECRET_KEY`, `FONT_AWESOME_TOKEN`,
`RUNTIME_DATABASE_PASSWORD`, `SCHEMA_DATABASE_PASSWORD`, and
`ROLE_SECRET_VALUES_JSON`. Routine staging deployment does not use a Cloudflare
API token, Terraform state credentials, or production identities. Keep credentials
for separate infrastructure/reset workflows until their consumers are migrated.

Never expose deployment credentials to PRs or use `pull_request_target`.
The deployer remains scoped to the existing staging resources. Role-secret
synchronization rejects incomplete or surplus keys and non-test Stripe keys.

## Accepted deployment configuration

Publish a version-1 JSON object containing `environment: "staging"`, `platform`
(the existing Terraform `staging` output), and `database` (its `staging_database`
output). These contain resource IDs, static role environment, secret IDs and the
private database endpoint/CA certificate; they must not contain secret values or
database passwords. Keep the snapshot private.

Review those outputs against the actual staging resources. Before publication,
validate the snapshot locally:

```bash
bash ops/scaleway/read-staging-configuration.sh \
  /private/path/configuration.json SHA256 /private/path/verified-output
```

Set `SCW_DEFAULT_PROJECT_ID`, `METADATA_BUCKET` and the approved
`STRIPE_TEST_ACCOUNT_ID` for this command. Use an authenticated Scaleway CLI
profile or environment credentials with container/namespace read access. The
validator binds the metadata bucket, checks the digest and private database TLS
configuration, and verifies each container's project, role name, privacy and
endpoint against the Scaleway API before writing deployment inputs. It supplies the non-secret
Stripe fixture account to ops through ordinary environment configuration.

Upload the exact validated bytes to
`configuration/staging/<sha256>.json` in
`evorto-staging-deployment-<suffix>` using an upload that fails if the key already
exists. Set `STAGING_CONFIGURATION_KEY` to that immutable key only after review.
The workflow downloads it once and verifies its digest before using it; it
never uploads the configuration, database inputs or secret values as CI artifacts.
After an infrastructure change, publish a new snapshot/key rather than replacing
an accepted object. Do not use a stale snapshot when resource identities, the
private database endpoint, CA certificate or role-secret IDs change.

`ROLE_SECRET_VALUES_JSON` is a flat object with role/name keys and non-empty
secret values. The current staging contract includes:

```text
web/CLIENT_ID
web/CLIENT_SECRET
web/COCKPIT_TRACES_TOKEN
web/ISSUER_BASE_URL
web/PUBLIC_GOOGLE_MAPS_API_KEY
web/S3_ACCESS_KEY_ID
web/S3_SECRET_ACCESS_KEY
web/SECRET
web/STRIPE_API_KEY
web/STRIPE_WEBHOOK_SECRET
worker/COCKPIT_TRACES_TOKEN
worker/S3_ACCESS_KEY_ID
worker/S3_SECRET_ACCESS_KEY
worker/STAGING_EMAIL_ALLOWLIST
worker/STRIPE_API_KEY
worker/TEM_API_TOKEN
ops/COCKPIT_TRACES_TOKEN
```

The workflow derives the three role-specific database URLs from the accepted
private endpoint and protected passwords, and supplies the verified CA. It
requires an exact match with the snapshot's role-secret IDs. Keep credential
values out of examples, configuration snapshots, state exports and logs.

## Cockpit and Grafana

Serverless Container logs and infrastructure metrics use the native `Scaleway
Logs` and `Scaleway Metrics` data sources. In Grafana, start with the
`Serverless Containers logs` and `Serverless Containers Overview` dashboards;
for raw LogQL, select `Scaleway Logs` and filter with
`{resource_type="serverless_container"}`. Terraform does not create duplicate
custom log or metric sources.

Application traces use the Terraform-managed `evorto-<environment>-traces`
source. Each role receives a write-only trace token through its protected
secret bundle. Without both `COCKPIT_TRACES_ENDPOINT` and
`COCKPIT_TRACES_TOKEN`, the runtime intentionally starts without a trace
exporter.

Hosted roles normally sample 10% of complete parent-based traces and retain
them for the included seven-day Cockpit window. Health, readiness, and version
requests are never traced. Local development keeps 100% sampling by default.
`TRACE_SAMPLING_RATIO` accepts a value from `0` through `1` when an explicit
runtime override is needed.

For a short staging investigation, manually dispatch `Deploy Scaleway staging`
with `full_trace_debugging` enabled. That deployment samples 100% of application
traces for all three roles. Dispatch the next forward deployment without that
option to restore the Terraform-owned 10% value.

Use [LATENCY_MONITORING.md](LATENCY_MONITORING.md) for warm-path objectives,
external synthetic checks, trace dashboards, alert thresholds, and latency
incident response. Application-side improvement work is ordered in
[../../LATENCY_IMPROVEMENT.md](../../LATENCY_IMPROVEMENT.md).
The temporary `Monitor staging latency` workflow has a manual trigger only.
Successful staging deployments retain a separate
10-sample report-only baseline in their deployment evidence.

## DNS and Transactional Email

Keep Cloudflare as the authoritative DNS provider. Terraform manages only the
unproxied `staging.evorto.app` CNAME, the SPF, DKIM, MX, and DMARC records for
`notifications.evorto.app`, and the unproxied `alpha.evorto.app` CNAME after the
production root is explicitly applied. It does not transfer or otherwise manage
the zone itself. Each environment exposes `managed_dns_record`; bootstrap
exposes `managed_transactional_email_dns_records`.

The Scaleway custom-domain resources explicitly depend on their Cloudflare
CNAME records. This ordering lets the public CNAME propagate before Scaleway
starts its HTTP-01 challenge and certificate issuance during a fresh apply.

All other existing zone records remain intentionally outside this Terraform
state and must be preserved. This includes the apex, `www`, and `docs` website
records; Microsoft 365 mail and autodiscovery records; the `messages` Mailgun
records; Productlane and Azure custom-domain records; and their verification
records. A Terraform apply in this directory neither imports nor deletes those
records.

The legacy Fly A, AAAA, and ACME records for `alpha.evorto.app` were removed
after preserving a zone export. Alpha intentionally has no DNS record until the
production root is explicitly reviewed and applied by the operator. That apply
creates only the Scaleway CNAME; export and inspect the live zone again before
cutover, and never use a bulk zone replacement.

After the managed records have propagated and Scaleway reports the email domain
healthy, set `validate_tem_dns = true`. The application always sends as
`Evorto <no-reply@notifications.evorto.app>` and retains tenant-specific
Reply-To headers.

Serverless Containers currently support at most 50 custom domains per
container. The one-host-per-environment design is below that limit, but any
future move to direct per-tenant container domains requires a scaling decision
before the limit is approached.

## Deployment and recovery

`scaleway-staging.yml` runs after PR Quality or E2E Baseline completes, or a
manual dispatch. It waits until both checks pass for the current main revision. It never cancels an active deployment. It:

1. proves that the exact main SHA passed both release gates;
2. builds Linux/amd64 once as `sha-<full-sha>` or reuses its immutable manifest;
3. verifies the runtime image, schema hash, SBOM, vulnerabilities, and size;
4. validates the accepted immutable staging configuration, then reconciles
   role-scoped secrets;
5. deploys private ops, rejects a destructive Drizzle plan, and applies the
   stable plan; initializes deterministic staging data only when every
   application table is empty, and otherwise preserves the existing data;
6. deploys worker and web at the same digest;
7. verifies health, readiness, version identity, tenant resolution, Auth0/RPC,
   and staging `noindex` behavior;
8. writes an immutable deployment manifest and updates the versioned latest
   pointer only after success.

If any forward-deploy check fails, the workflow remains visibly failed and does
not update the successful manifest pointer. It never redeploys an older image
after a schema release. Apply a reviewed infrastructure change explicitly or
ship a corrected forward revision, then rerun the deployment.

The production workflow and Terraform roots remain dormant future configuration.
Do not dispatch production or enable it as part of staging delivery.

Both the managed database instance and the application database declare
`prevent_destroy`. This blocks Terraform destruction or replacement while their
resource blocks remain in the configuration; removing a resource block also
removes its protection and requires explicit data-retention review. The protected
staging reset workflow resets and seeds through its private ops endpoint without
removing either Terraform database resource.

## Operational drills

Record every drill in the deployment metadata bucket under a unique timestamped
key. Evidence must include actor, start/end timestamps, source revision/digest,
commands or console operation IDs, observed result, and follow-up owner.

### Restore

1. Select a staging automatic backup and restore it to a new temporary private
   PostgreSQL instance; never overwrite the active database for the drill.
2. Attach a temporary private ops container or otherwise use a private-network
   schema identity to verify TLS, required extensions, schema hash, row counts,
   and representative tenant/registration/finance records.
3. Measure and record elapsed restoration time. The current commitment is a
   tested measurement, not an unproven RTO.
4. Delete the temporary restore only after the evidence object exists.

Run this before staging acceptance, quarterly, and after material backup or
schema changes. Staging retains daily backups for seven days. The production
root declares daily backups retained 30 days and a 24-hour RPO.

### Drift detection

1. Make one harmless, documented staging-only drift change such as a container
   description/tag through the console.
2. Run an operator-side read-only Terraform plan against configuration matching
   the live state. Confirm it reports the drift; an app deployment is not a
   substitute for this check.
3. Review and apply the infrastructure correction explicitly. Do not apply the
   proposed isolated roots to the current combined state.
4. Regenerate the accepted deployment configuration if its values changed, then
   rerun deployment and retain the plan and `/version` evidence.

### Forward recovery

1. Retain the failed workflow, image, schema, and smoke evidence.
2. Correct the defect in a new revision without reversing the applied schema.
3. Run the full local release gate and deploy that forward revision through the
   normal protected workflow.
4. Verify `/healthz`, `/readyz`, `/version`, SSR, and one RPC call, then record
   both the failed and corrected identities.

## Credential rotation

- Scaleway deployer, state, S3 role, and TEM API keys: every 90 days and after
  any suspected exposure or operator departure.
- application session secret: every 90 days with a planned sign-in reset;
- database passwords: every 90 days as a coordinated maintenance operation.
  Review and explicitly apply the password secret and matching incremented
  password-version variable in the environment infrastructure root, then run
  the protected forward deployment to reconcile runtime secrets and verify
  connectivity. Publish an updated configuration snapshot if its non-secret
  values changed. Never reuse or decrement a password version;
- Stripe webhook secret: whenever the endpoint is recreated or exposure is
  suspected;
- Auth0 and other provider credentials: follow provider guidance, at least
  annually, and immediately on suspected exposure.

Use overlap where the provider supports multiple active keys. Reconcile the new
value, verify the exact deployed revision/digest and a functional smoke test,
then revoke the old key. Never print current or replacement values in logs.

## Local verification

Run these in addition to the complete application gate in the root README:

```bash
bun run infra:check
bun run image:security:local
```

`infra:check` formats and validates all three Terraform roots and scans the
configuration. `image:security:local` builds the actual Linux/amd64 image,
checks its runtime contents and uncompressed size, exports private source maps,
creates an SBOM, and runs the pinned vulnerability scanner.

Staging is not accepted merely because Terraform applies. Complete
[STAGING_ACCEPTANCE.md](STAGING_ACCEPTANCE.md), including restore, drift,
forward-recovery, browser, and live-provider evidence, before considering
production enablement.
