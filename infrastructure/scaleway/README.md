# Scaleway Hosting

This directory defines the staging-first Scaleway platform in `fr-par`.
`staging.evorto.app` is the only provisioned tenant hostname by default.
Production is described by the same module but remains absent while
`production_enabled = false` and the protected GitHub variable
`PRODUCTION_ENABLED` is not exactly `true`.

The application remains the authorization boundary. The database has separate
runtime and schema users, but no row-level security policies. Fly configuration
is intentionally outside this migration. Legacy data migration is a later,
best-effort project after functional completion.

## Ownership split

Terraform owns static resources:

- the staging project, VPC, private network, registry, PostgreSQL 17 instance,
  role identities, Secret Manager entries, Cockpit sources, alert contact
  point, buckets, containers, custom domain, and worker CRON triggers;
- the disabled production definition, including its HA database shape;
- secret names and role assignment, but never secret values;
- initial container configuration, while ignoring the image and deployment
  environment fields subsequently owned by the deploy workflow.

Deployment workflows own dynamic release state:

- the immutable image digest and revision;
- current role-scoped secret values synchronized from protected environments;
- schema explain/apply invocations;
- private source maps, SBOMs, and append-only deployment manifests;
- worker/web release ordering, smoke tests, and image rollback.

This split is required because Serverless Container secret values are copied
into container configuration rather than referenced directly from Secret
Manager. Values are read, masked, reconciled, and injected only by the
protected deployment environment.

Terraform creates each role with `APP_BOOTSTRAP=true` so the first apply can
complete before any secret value exists in container configuration. Bootstrap
mode initializes no database or provider service and exposes only `/healthz`
and a no-store `/readyz`; every other route is absent. `deploy-role.sh` always
sets `APP_BOOTSTRAP=false` together with a validated full revision, image
digest, and the role's secrets. Normal runtime validation then fails closed if
release identity, Cockpit, readiness-host, proxy, worker-mode, or schema
configuration is incomplete. A deployment smoke test cannot accept a
bootstrap container because it requires the exact `/version` response, SSR,
and RPC behavior.

## One-time bootstrap

1. Create a small bootstrap Scaleway project manually. Create a least-privilege
   Object Storage application/API key for that project outside Terraform.
2. Copy `bootstrap/terraform.tfvars.example` to an ignored `.auto.tfvars` file,
   choose a globally unique state bucket name, then apply the bootstrap root:

   ```bash
   terraform -chdir=infrastructure/scaleway/bootstrap init
   terraform -chdir=infrastructure/scaleway/bootstrap apply
   ```

3. Copy `backend.hcl.example` to ignored `backend.hcl`, set only the bucket
   name, and export the state identity as `AWS_ACCESS_KEY_ID` and
   `AWS_SECRET_ACCESS_KEY`. Never put credentials in backend files or tfvars.
4. Initialize the platform root with the remote backend:

   ```bash
   terraform -chdir=infrastructure/scaleway init \
     -backend-config=backend.hcl \
     -reconfigure
   ```

5. Copy `terraform.tfvars.example` to an ignored `.auto.tfvars` file. Keep
   `production_enabled = false`. Use the zero digest only for the targeted
   initial registry bootstrap; a full apply requires a real immutable image.
6. Apply the root once with an organization administrator identity. Terraform
   creates the dedicated `evorto-github-deployer` application. Create its API
   key outside Terraform, move deployment to that identity, and remove the
   bootstrap administrator credentials from GitHub.
7. Create API keys outside Terraform for the emitted `web` and `worker` role
   application IDs. Put only those static key values in the corresponding
   protected environment secret JSON. Rotate them on the schedule below.

The state backend uses bucket versioning, SSE-ONE, `prevent_destroy`, and the S3
conditional lockfile. Retain the bootstrap project and its recovery procedure
independently from application projects.

## GitHub environments

Create and protect these environments:

- `scaleway-staging`: deployment credentials and staging values;
- `scaleway-staging-reset`: a stricter approval boundary for destructive reset
  and reseed;
- `scaleway-production`: production values plus required human approval;
- the existing protected provider-certification environments.

The staging workflow also needs repository/environment variables for
`SCW_ORGANIZATION_ID`, `SCW_TEM_PROJECT_ID`, `TERRAFORM_STATE_BUCKET`,
`BUCKET_SUFFIX`, and `ALERT_EMAIL`. Store the state S3 key pair, deployer
Scaleway key pair, schema/runtime database passwords, Font Awesome token, and
`ROLE_SECRET_VALUES_JSON` as secrets. Production has distinct database
passwords and a distinct `ROLE_SECRET_VALUES_JSON` value.

`ROLE_SECRET_VALUES_JSON` is a flat object. Keys are the role and variable name
joined by `/`; values are protected non-empty strings. Do not commit an example
containing values. The staging contract is:

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

Production omits `worker/STAGING_EMAIL_ALLOWLIST`. The deploy workflow derives
the three `DATABASE_URL` values and `DATABASE_TLS_CA_CERTIFICATE` values from
Terraform's sensitive database output, and rejects an incomplete or surplus
key set. Staging additionally rejects non-test Stripe secret keys.

Never use `pull_request_target` or expose Scaleway credentials to pull requests.
The staging deploy accepts only the exact `main` revision that has passed both
`CI/gate` and the protected provider baseline.

## DNS and Transactional Email

Keep the current authoritative DNS provider. Copy the values from
`terraform output -json external_dns_records` into that provider:

- the staging CNAME to the generated web container hostname;
- SPF, DKIM, MX, and DMARC-compatible records for
  `notifications.evorto.app`;
- the production CNAME only after production is explicitly enabled.

After records have propagated and Scaleway reports the email domain healthy,
set `validate_tem_dns = true`. The application always sends as
`Evorto <no-reply@notifications.evorto.app>` and retains tenant-specific
Reply-To headers.

Serverless Containers currently support at most 50 custom domains per
container. The one-host-per-environment design is below that limit, but any
future move to direct per-tenant container domains requires a scaling decision
before the limit is approached.

## Deployment and rollback

`scaleway-staging.yml` runs after an eligible protected baseline, manually, and
every 30 minutes for reconciliation. It never cancels an active deployment. It:

1. proves that the exact main SHA passed both release gates;
2. builds Linux/amd64 once as `sha-<full-sha>` or reuses its immutable manifest;
3. verifies the runtime image, schema hash, SBOM, vulnerabilities, and size;
4. reconciles Terraform and role-scoped secrets;
5. deploys private ops, rejects a destructive Drizzle plan, and applies the
   stable plan;
6. deploys worker and web at the same digest;
7. verifies health, readiness, version identity, tenant resolution, Auth0/RPC,
   and staging `noindex` behavior;
8. writes an immutable deployment manifest and updates the versioned latest
   pointer only after success.

If a post-traffic check fails, the workflow redeploys the prior digest. Schema
changes are never rolled back; they must remain forward-only and compatible
with both the previous and new images.

The production workflow is dispatch-only and is a no-op unless the repository
variable `PRODUCTION_ENABLED` is exactly `true`. It accepts only an immutable,
successful staging manifest, copies that exact digest into the production
registry without rebuilding, waits for protected-environment approval, applies
a safe schema plan, and smokes `alpha.evorto.app`.

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
schema changes. Staging retains daily backups for seven days. Disabled
production is defined for daily backups retained 30 days and a 24-hour RPO.

### Drift reconciliation

1. Make one harmless, documented staging-only drift change such as a container
   description/tag through the console.
2. dispatch the staging workflow for the current accepted revision;
3. confirm Terraform restores the declared value without rebuilding the image
   or changing its digest;
4. store the plan/apply and `/version` evidence, then confirm the next plan is
   empty apart from workflow-owned ignored fields.

### Image rollback

1. retain two known-good staging manifests;
2. deliberately fail a post-traffic smoke check in a controlled drill or invoke
   the documented prior-manifest role redeploy sequence;
3. prove web and worker return to the previous digest while schema state remains
   forward-only;
4. verify `/healthz`, `/readyz`, `/version`, SSR, and one RPC call, then record
   both the failed and restored identities.

## Credential rotation

- Scaleway deployer, state, S3 role, and TEM API keys: every 90 days and after
  any suspected exposure or operator departure.
- application session secret: every 90 days with a planned sign-in reset;
- database passwords: every 90 days, changing the managed user and protected
  environment in one maintenance window;
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

`infra:check` formats and validates both Terraform roots and scans the
configuration. `image:security:local` builds the actual Linux/amd64 image,
checks its runtime contents and uncompressed size, exports private source maps,
creates an SBOM, and runs the pinned vulnerability scanner.

Staging is not accepted merely because Terraform applies. Complete
[STAGING_ACCEPTANCE.md](STAGING_ACCEPTANCE.md), including restore, drift,
rollback, browser, and live-provider evidence, before considering production
enablement.
