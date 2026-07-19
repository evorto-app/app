import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const source = (relativePath: string): string =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const between = (contents: string, start: string, end?: string): string => {
  const startIndex = contents.indexOf(start);
  expect(startIndex, `missing source marker: ${start}`).toBeGreaterThanOrEqual(
    0,
  );
  const endIndex = end ? contents.indexOf(end, startIndex + start.length) : -1;
  return contents.slice(startIndex, endIndex === -1 ? undefined : endIndex);
};

describe('Scaleway hosting source', () => {
  it('retires the legacy Fly deployment surface and hostname', () => {
    for (const removedPath of [
      '.github/workflows/fly-deploy.yml',
      'fly.toml',
    ]) {
      expect(existsSync(path.join(repositoryRoot, removedPath))).toBe(false);
    }

    for (const currentSource of [
      source('angular.json'),
      source('migration/index.ts'),
      source('public/robots.txt'),
      source('public/sitemap.xml'),
      source('src/db/setup-database.ts'),
    ]) {
      expect(currentSource).not.toContain('evorto.fly.dev');
    }
  });

  it('keeps production defined but disabled until an explicit protected promotion', () => {
    const main = source('infrastructure/scaleway/main.tf');
    const variables = source('infrastructure/scaleway/variables.tf');
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');

    expect(variables).toContain('variable "production_enabled"');
    expect(variables).toMatch(
      /variable "production_enabled" \{[\s\S]*?default\s+= false/u,
    );
    expect(main).toContain('count = var.production_enabled ? 1 : 0');
    expect(main).toContain(
      'hostname                       = "alpha.evorto.app"',
    );
    expect(staging).toContain('TF_VAR_production_enabled: "false"');
    expect(production).toContain("if: vars.PRODUCTION_ENABLED == 'true'");
    expect(production).toContain('CONFIRMATION: ${{ inputs.confirmation }}');
    expect(production).toContain(
      'if [ "${CONFIRMATION}" != "promote-alpha" ]; then',
    );
    expect(production).not.toContain('pull_request_target:');
  });

  it('provisions private PostgreSQL 17 with separate runtime and schema users', () => {
    const main = source('infrastructure/scaleway/main.tf');
    const database = source(
      'infrastructure/scaleway/modules/environment/database.tf',
    );

    expect(database).toContain('engine        = "PostgreSQL-17"');
    expect(database).toContain('encryption_at_rest        = true');
    expect(database).toContain('backup_schedule_frequency = 24');
    expect(database).toContain('private_network {');
    expect(database).not.toContain('load_balancer');
    expect(database).toContain('user_name           = "schema_owner"');
    expect(database).toContain('name                = "application_runtime"');
    expect(database).toContain('is_admin            = false');
    expect(main).toContain('database_node_type             = "DB-DEV-S"');
    expect(main).toContain('database_backup_retention_days = 7');
    expect(main).toContain('database_node_type             = "DB-POP2-2C-8G"');
    expect(main).toContain('database_is_ha                 = true');
    expect(main).toContain('database_backup_retention_days = 30');
  });

  it('keeps web, worker, and ops isolated in one bounded container shape', () => {
    const containers = source(
      'infrastructure/scaleway/modules/environment/containers.tf',
    );
    const server = source('src/server.ts');
    const roles = source('src/server/config/deployment-config.ts');
    const web = between(
      containers,
      'resource "scaleway_container" "web"',
      'resource "scaleway_container" "worker"',
    );
    const worker = between(
      containers,
      'resource "scaleway_container" "worker"',
      'resource "scaleway_container" "ops"',
    );
    const ops = between(
      containers,
      'resource "scaleway_container" "ops"',
      'resource "scaleway_container_domain" "web"',
    );

    expect(roles).toContain("['web', 'worker', 'ops']");
    expect(containers).toContain('APP_BOOTSTRAP                    = "true"');
    expect(containers.match(/cpu_limit\s+= 560/gu)).toHaveLength(3);
    expect(
      containers.match(/memory_limit_bytes\s+= 1073741824/gu),
    ).toHaveLength(3);
    expect(containers.match(/private_network_id\s+=/gu)).toHaveLength(3);
    expect(web).toContain('privacy                = "public"');
    expect(web).toContain('max_scale              = 3');
    expect(web.match(/path = "\/readyz"/gu)).toHaveLength(2);
    for (const privateRole of [worker, ops]) {
      expect(privateRole).toContain('privacy                = "private"');
      expect(privateRole).toContain('min_scale              = 0');
      expect(privateRole).toContain('max_scale              = 1');
      expect(privateRole.match(/path = "\/healthz"/gu)).toHaveLength(2);
    }
    expect(mainMinScale(source('infrastructure/scaleway/main.tf'))).toEqual({
      production: 1,
      staging: 0,
    });
    expect(server).toContain('const webRoutesLayer = Layer.mergeAll(');
    expect(server).toContain('const workerRoutesLayer = Layer.mergeAll(');
    expect(server).toContain('const opsRoutesLayer = Layer.mergeAll(');
    expect(server).toContain('const bootstrapRoutesLayer = Layer.mergeAll(');
    expect(server).toContain('runtimeRole.bootstrap');
    expect(server).toContain(
      "runtimeRole.bootstrap || runtimeRole.role === 'ops'",
    );
    expect(server).toContain("runtimeRole.role === 'worker'");
    expect(server).toContain("runtimeRole.role === 'ops'");
  });

  it('bounds local database pools while sizing the web role for parallel browser coverage', () => {
    const compose = source('docker-compose.yml');
    const web = between(compose, '  evorto:', '  worker:');
    const worker = between(compose, '  worker:', '  stripe:\n    image:');

    expect(web).toContain('DATABASE_POOL_MAX: "20"');
    expect(worker).toContain('DATABASE_POOL_MAX: "5"');
  });

  it('defines only bounded worker CRON endpoints with explicit JSON bodies', () => {
    const containers = source(
      'infrastructure/scaleway/modules/environment/containers.tf',
    );
    const triggers = between(
      containers,
      'locals {\n  worker_triggers',
      'resource "scaleway_container_trigger" "worker"',
    );

    expect(triggers).toContain('/internal/worker/email-delivery');
    expect(triggers).toContain('/internal/worker/expired-checkout-cleanup');
    expect(triggers).toContain('/internal/worker/receipt-orphan-cleanup');
    expect(triggers).toContain('/internal/worker/stripe-refunds');
    expect(triggers.match(/body\s+= \{ limit = (?:25|50) \}/gu)).toHaveLength(
      4,
    );
    expect(containers).toContain('http_method = "post"');
    expect(containers).toContain('body     = jsonencode(each.value.body)');
  });

  it('keeps application, deployment, and Terraform state storage private and durable', () => {
    const storage = source(
      'infrastructure/scaleway/modules/environment/storage.tf',
    );
    const bootstrap = source('infrastructure/scaleway/bootstrap/main.tf');
    const versions = source('infrastructure/scaleway/versions.tf');

    expect(storage).toContain('allowed_origins = ["https://${var.hostname}"]');
    expect(storage.match(/versioning \{\n\s+enabled = true/gu)).toHaveLength(2);
    expect(storage.match(/acl\s+= "private"/gu)).toHaveLength(2);
    expect(storage.match(/sse_algorithm = "AES256"/gu)).toHaveLength(2);
    expect(storage).toContain('abort_incomplete_multipart_upload_days = 1');
    expect(storage).toContain('prefix  = "source-maps/"');
    expect(storage).toContain('days = 90');
    expect(bootstrap).toContain('prevent_destroy = true');
    expect(bootstrap).toContain('acl        = "private"');
    expect(bootstrap).toContain('sse_algorithm = "AES256"');
    expect(versions).toContain('use_lockfile                = true');
  });

  it('declares role-scoped secret names without putting values in Terraform state', () => {
    const secrets = source(
      'infrastructure/scaleway/modules/environment/secrets.tf',
    );
    const containers = source(
      'infrastructure/scaleway/modules/environment/containers.tf',
    );

    for (const requiredName of [
      'CLIENT_SECRET',
      'COCKPIT_TRACES_TOKEN',
      'DATABASE_TLS_CA_CERTIFICATE',
      'DATABASE_URL',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'TEM_API_TOKEN',
    ]) {
      expect(secrets, requiredName).toContain(`"${requiredName}"`);
    }
    expect(secrets).toContain(
      'var.environment == "staging" ? toset(["STAGING_EMAIL_ALLOWLIST"])',
    );
    expect(secrets).toContain('protected   = true');
    expect(secrets).not.toContain('scaleway_secret_version');
    expect(
      containers.match(/secret_environment_variables = \{\}/gu),
    ).toHaveLength(3);
    expect(containers.match(/ignore_changes = \[/gu)).toHaveLength(3);
    expect(containers).not.toMatch(/^\s+SCW_[A-Z0-9_]+\s+=/gmu);
  });

  it('enables Cockpit sources, all provider alerts, and release-aware logs', () => {
    const observability = source(
      'infrastructure/scaleway/modules/environment/observability.tf',
    );
    const logger = source('src/server/effect/server-logger.layer.ts');
    const main = source('infrastructure/scaleway/main.tf');

    for (const type of ['traces', 'logs', 'metrics']) {
      expect(observability).toContain(`type           = "${type}"`);
    }
    expect(observability).toContain(
      'preconfigured_alert_ids = toset(data.scaleway_cockpit_preconfigured_alert.available.alerts[*].preconfigured_rule_id)',
    );
    expect(observability).toContain('email = var.alert_email');
    expect(main).toContain('resource "scaleway_billing_budget" "organization"');
    for (const annotation of [
      'environment:',
      'imageDigest:',
      'revision:',
      'role:',
    ]) {
      expect(logger, annotation).toContain(annotation);
    }
  });

  it('builds once, records immutable evidence, and promotes the exact OCI digest', () => {
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');
    const deployRole = source('ops/scaleway/deploy-role.sh');

    expect(staging).toContain('workflow_run:');
    expect(staging).toContain('cron: "*/30 * * * *"');
    expect(staging).toContain('cancel-in-progress: false');
    expect(staging).toContain('ops/scaleway/require-release-gates.sh');
    expect(staging).toContain('--platform linux/amd64');
    expect(staging).toContain('--provenance=mode=max');
    expect(staging).toContain("--if-none-match '*'");
    expect(staging).toContain('/internal/ops/schema-explain');
    expect(staging).toContain('Roll back traffic roles to the previous digest');

    expect(production).not.toContain('docker build ');
    expect(production).not.toContain('docker buildx build ');
    expect(production).toContain('docker buildx imagetools create');
    expect(production).toContain('docker buildx imagetools inspect --raw');
    expect(production).toContain(
      'if [ "${target_digest}" != "${SOURCE_DIGEST}" ]; then',
    );
    expect(production).toContain('sourceStagingManifestKey:');
    expect(production).toContain(
      'Roll back production traffic roles on failure',
    );
    expect(deployRole).toContain('APP_BOOTSTRAP: "false"');
  });

  it('gates ordinary CI and destructive staging reset separately', () => {
    const quality = source('.github/workflows/pr-quality.yml');
    const reset = source('.github/workflows/scaleway-staging-reset.yml');
    const runtimeVerifier = source('ops/scaleway/verify-runtime-image.sh');

    expect(quality).toContain('name: Terraform validation and static scan');
    expect(quality).toContain(
      'name: Linux image, SBOM, vulnerabilities, and size',
    );
    expect(quality).toContain('name: CI/gate');
    expect(quality).toContain('bun run test:integration:postgres');
    expect(reset).toContain(
      'if [ "${CONFIRMATION}" != "reset-and-seed-staging" ]; then',
    );
    expect(reset).toContain('environment: scaleway-staging-reset');
    expect(reset).toContain('/internal/ops/seed-staging');
    expect(runtimeVerifier).toContain('maximum_size_bytes=1000000000');
    expect(runtimeVerifier).toContain("'api\\.resend\\.com|cloudflare[_-]r2");
    expect(runtimeVerifier).toContain('|@sentry|@neondatabase|resend)');
  });
});

const mainMinScale = (main: string) => {
  const staging = between(main, 'module "staging"', 'module "production"');
  const production = between(
    main,
    'module "production"',
    'resource "scaleway_iam_application" "deployer"',
  );
  const scale = (block: string): number => {
    const match = block.match(/web_min_scale\s+= (\d+)/u);
    expect(match).not.toBeNull();
    return Number(match?.[1]);
  };
  return { production: scale(production), staging: scale(staging) };
};
