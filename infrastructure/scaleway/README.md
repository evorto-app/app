# Scaleway Hosting

This directory defines the staging-first Scaleway platform in `fr-par`.
`bootstrap`, `staging`, and `production` are independent Terraform roots with
separate private state buckets, state identities, and fixed keys. Applying
staging cannot read, plan, or change a production resource. The production
workflow remains a no-op until the protected GitHub variable
`PRODUCTION_ENABLED` is exactly `true`.

The application remains the authorization boundary. The database has separate
runtime and schema users, but no row-level security policies. The retired Fly
deployment is not part of this fresh Scaleway environment.

## Ownership split

The manually applied `bootstrap` root owns organization and shared foundation
resources:

- three versioned state buckets and state identities, staging and production
  projects, and both private registries;
- project-scoped staging and production deployer identities;
- web and worker identities with matching Object Storage IAM permissions, plus
  bucket-policy narrowing in the environment roots;
- organization billing budget and shared Transactional Email domain and DNS.

The `staging` and `production` roots each own only one environment:

- VPC, private network, PostgreSQL 17 instance, Secret Manager entries, custom
  Cockpit trace source, alert contact point, buckets, containers, custom domain,
  and worker CRON triggers;
- secret names and role assignment, but never secret values;
- initial container configuration, while ignoring the image and deployment
  environment fields subsequently owned by the deploy workflow.

Deployment workflows own dynamic release state:

- the immutable image digest and revision;
- current role-scoped secret values synchronized from protected environments;
- schema explain/apply invocations;
- private source maps, SBOMs, and append-only deployment manifests;
- worker/web release ordering, smoke tests, and visible forward-deploy failures.

This split is required because Serverless Container secret values are copied
into container configuration rather than referenced directly from Secret
Manager. Values are read, masked, reconciled, and injected only by the
protected deployment environment.

Deployment workflows never apply Terraform. Infrastructure changes are planned,
reviewed, and applied explicitly against the matching root and state before a
forward deployment. Each deployment runs a read-only detailed plan and stops
visibly when configuration or remote drift would change infrastructure.

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

1. Create a small bootstrap Scaleway project manually. Use an organization
   administrator only from the operator workstation; never store that identity
   in GitHub.
2. Copy `bootstrap/terraform.tfvars.example` to an ignored `.auto.tfvars` file,
   choose three different globally unique state bucket names, export a
   Cloudflare token limited to DNS edits for `evorto.app`, and select the
   Essential plan in the shared Transactional Email project. Then apply
   bootstrap with local state:

   ```bash
   terraform -chdir=infrastructure/scaleway/bootstrap init -backend=false
   terraform -chdir=infrastructure/scaleway/bootstrap apply
   ```

3. Create one API key outside Terraform for each state application ID in the
   `backend_configuration` output. Do not reuse a key between roots. Copy each
   root's `backend.hcl.example` to its ignored `backend.hcl` and set only that
   root's bucket name. Never put credentials in backend files or tfvars.
   Migrate the local bootstrap state using only the bootstrap state key:

   ```bash
   AWS_ACCESS_KEY_ID="${BOOTSTRAP_TERRAFORM_STATE_ACCESS_KEY_ID}" \
   AWS_SECRET_ACCESS_KEY="${BOOTSTRAP_TERRAFORM_STATE_SECRET_ACCESS_KEY}" \
   terraform -chdir=infrastructure/scaleway/bootstrap init \
     -backend-config=backend.hcl \
     -migrate-state
   ```

4. Initialize each environment root with only its matching state key:

   ```bash
   AWS_ACCESS_KEY_ID="${STAGING_TERRAFORM_STATE_ACCESS_KEY_ID}" \
   AWS_SECRET_ACCESS_KEY="${STAGING_TERRAFORM_STATE_SECRET_ACCESS_KEY}" \
   terraform -chdir=infrastructure/scaleway/staging init \
     -backend-config=backend.hcl \
     -reconfigure

   AWS_ACCESS_KEY_ID="${PRODUCTION_TERRAFORM_STATE_ACCESS_KEY_ID}" \
   AWS_SECRET_ACCESS_KEY="${PRODUCTION_TERRAFORM_STATE_SECRET_ACCESS_KEY}" \
   terraform -chdir=infrastructure/scaleway/production init \
     -backend-config=backend.hcl \
     -reconfigure
   ```

5. Copy the bootstrap `environments` output into the matching protected GitHub
   environment variables. Create API keys outside Terraform for each emitted
   deployer, web, and worker application. The staging deployer can modify only
   staging. The production deployer can modify only production and has read-only
   access to staging release artifacts needed for promotion.
6. Put only the web and worker API key values in the matching protected
   environment secret JSON. Rotate them on the schedule below.
7. From the operator workstation, export only the selected environment's
   deployer, state, and Terraform variables, review a saved plan for that root,
   and apply it explicitly. Provision staging first. Do not apply production
   until the separate production-enable decision. The subsequent deployment
   must observe an empty detailed plan before it can release application roles.

Each state backend uses its own private bucket and project-scoped application,
plus bucket versioning, AES-256 server-side encryption, `prevent_destroy`, and
the S3 conditional lockfile. A staging state credential has no production
project permission and no production bucket-policy grant. Retain the bootstrap
project and its recovery procedure independently from application projects.

Scaleway requires both project IAM permission and a matching bucket-policy
allow. Bootstrap grants web and worker identities only the bucket/object
operations their roles need. Each bucket policy then narrows those permissions
to that one bucket. Terraform creates the private ACL and AES-256 encryption
configuration before installing the policy. There is no persistent human or
console-reader grant to application data or private deployment artifacts.

## GitHub environments

Create and protect these environments:

- `scaleway-staging`: deployment credentials and staging values;
- `scaleway-staging-reset`: a stricter approval boundary for destructive reset
  and reseed;
- `scaleway-production`: production values plus required human approval;
- the existing protected provider-certification environments.

Each deployment environment needs `SCW_ORGANIZATION_ID`, `SCW_PROJECT_ID`,
`SCW_DEPLOYER_APPLICATION_ID`, `SCW_WEB_APPLICATION_ID`,
`SCW_WORKER_APPLICATION_ID`, `SCW_TEM_PROJECT_ID`, `BUCKET_SUFFIX`,
`CLOUDFLARE_ZONE_ID`, and `ALERT_EMAIL`. Both staging environments need the
`STAGING_TERRAFORM_STATE_BUCKET` variable and
`STAGING_TERRAFORM_STATE_ACCESS_KEY_ID` and
`STAGING_TERRAFORM_STATE_SECRET_ACCESS_KEY` secrets. Production needs the
corresponding three `PRODUCTION_TERRAFORM_STATE_*` entries. Never configure a
generic state credential or bucket variable.

Staging additionally needs the non-secret
`SCW_PRODUCTION_DEPLOYER_APPLICATION_ID` so its metadata bucket can grant that
one principal read-only promotion access. Staging uses
`SCHEMA_DATABASE_PASSWORD_VERSION` and `RUNTIME_DATABASE_PASSWORD_VERSION`;
production uses the corresponding `PRODUCTION_` names. Start every password
version at `1`.

Store the scoped `CLOUDFLARE_API_TOKEN`, matching project-scoped deployer key
pair, schema/runtime database passwords, Font Awesome token, and
`ROLE_SECRET_VALUES_JSON` as secrets. Production does not receive staging
database passwords, state credentials, or staging Terraform variables. Its
deployer has only the read permissions required to fetch the accepted staging
manifest and registry digest.

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
Terraform's sensitive database output. The private-network IP in each URL is
also the certificate identity issued by Scaleway, so clients verify both the CA
and private endpoint without a public endpoint or a separate server-name
override. `DATABASE_TLS_SERVER_NAME` remains an optional application setting
for providers whose connection address differs from the certificate identity.
Secret synchronization rejects an incomplete or surplus key set. Staging
additionally rejects non-test Stripe secret keys.

Never use `pull_request_target` or expose Scaleway credentials to pull requests.
The staging deploy accepts only the exact `main` revision that has passed both
`CI/gate` and the protected provider baseline.

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

`scaleway-staging.yml` runs after an eligible protected baseline or a manual
dispatch. It never cancels an active deployment. It:

1. proves that the exact main SHA passed both release gates;
2. builds Linux/amd64 once as `sha-<full-sha>` or reuses its immutable manifest;
3. verifies the runtime image, schema hash, SBOM, vulnerabilities, and size;
4. requires an empty read-only Terraform plan, then reconciles role-scoped
   secrets;
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

The production workflow is dispatch-only and is a no-op unless the repository
variable `PRODUCTION_ENABLED` is exactly `true`. It accepts only an immutable,
successful staging manifest, copies that exact digest into the production
registry without rebuilding, waits for protected-environment approval, requires
an empty read-only production Terraform plan, applies a safe schema plan, and
smokes `alpha.evorto.app`.

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
2. Dispatch the staging workflow for the current accepted revision and confirm
   its read-only Terraform plan reports the drift and stops before deployment.
3. Review and apply the matching staging root explicitly from the operator
   workstation.
4. Rerun the deployment, store the plan and `/version` evidence, and confirm the
   plan is empty apart from workflow-owned ignored fields.

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
- database passwords: every 90 days, changing the password secret and
  incrementing its matching password-version variable in the same protected
  deployment. Never reuse or decrement a version;
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
