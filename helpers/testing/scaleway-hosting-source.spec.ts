import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
    expect(main).toMatch(/hostname\s+= "alpha\.evorto\.app"/u);
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
    const outputs = source(
      'infrastructure/scaleway/modules/environment/outputs.tf',
    );
    const moduleVariables = source(
      'infrastructure/scaleway/modules/environment/variables.tf',
    );
    const rootVariables = source('infrastructure/scaleway/variables.tf');
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');

    expect(database).toContain('engine        = "PostgreSQL-17"');
    expect(database).toContain('encryption_at_rest        = true');
    expect(database).toContain('backup_schedule_frequency = 24');
    expect(database).toContain('private_network {');
    expect(database).not.toContain('load_balancer');
    expect(outputs).toContain(
      'host          = scaleway_rdb_instance.application.private_network[0].ip',
    );
    expect(outputs).not.toContain(
      'scaleway_rdb_instance.application.private_network[0].hostname',
    );
    expect(database).toContain('user_name           = "schema_owner"');
    expect(database).toContain('name                = "application_runtime"');
    expect(database).toContain('is_admin            = false');
    expect(database).toContain(
      'password_wo_version = var.schema_database_password_version',
    );
    expect(database).toContain(
      'password_wo_version = var.runtime_database_password_version',
    );
    expect(moduleVariables).toContain(
      'variable "schema_database_password_version"',
    );
    expect(moduleVariables).toContain(
      'variable "runtime_database_password_version"',
    );
    expect(rootVariables).toContain(
      'variable "staging_schema_database_password_version"',
    );
    expect(rootVariables).toContain(
      'variable "staging_runtime_database_password_version"',
    );
    expect(main).toContain(
      'schema_database_password_version    = var.staging_schema_database_password_version',
    );
    expect(main).toContain(
      'runtime_database_password_version   = var.staging_runtime_database_password_version',
    );
    expect(staging).toContain(
      'TF_VAR_staging_schema_database_password_version: ${{ vars.SCHEMA_DATABASE_PASSWORD_VERSION }}',
    );
    expect(staging).toContain(
      'TF_VAR_staging_runtime_database_password_version: ${{ vars.RUNTIME_DATABASE_PASSWORD_VERSION }}',
    );
    expect(production).toContain(
      'TF_VAR_production_schema_database_password_version: ${{ vars.PRODUCTION_SCHEMA_DATABASE_PASSWORD_VERSION }}',
    );
    expect(production).toContain(
      'TF_VAR_production_runtime_database_password_version: ${{ vars.PRODUCTION_RUNTIME_DATABASE_PASSWORD_VERSION }}',
    );
    expect(main).toMatch(/database_node_type\s+= "DB-DEV-S"/u);
    expect(main).toMatch(/database_backup_retention_days\s+= 7/u);
    expect(main).toMatch(/database_node_type\s+= "DB-POP2-2C-8G"/u);
    expect(main).toMatch(/database_is_ha\s+= true/u);
    expect(main).toMatch(/database_backup_retention_days\s+= 30/u);
    expect(main).toContain('"IPAMReadOnly"');
  });

  it('verifies managed Drizzle schema connections against the database identity', async () => {
    const environmentKeys = [
      'DATABASE_TLS_CA_CERTIFICATE',
      'DATABASE_TLS_REQUIRED',
      'DATABASE_URL',
    ] as const;
    const originalEnvironment = Object.fromEntries(
      environmentKeys.map((key) => [key, process.env[key]]),
    );
    const caCertificate = [
      '-----BEGIN CERTIFICATE-----',
      'managed-database-ca',
      '-----END CERTIFICATE-----',
    ].join('\n');
    try {
      process.env['DATABASE_TLS_CA_CERTIFICATE'] = caCertificate;
      process.env['DATABASE_TLS_REQUIRED'] = 'true';
      process.env['DATABASE_URL'] =
        'postgresql://schema_owner:p%40ss%2Fword@10.0.0.8:6432/evorto%20staging';
      const configUrl = pathToFileURL(
        path.join(repositoryRoot, 'ops/drizzle.config.mjs'),
      );
      configUrl.searchParams.set('test', 'managed-database-tls');
      const importedConfig: unknown = await import(
        /* @vite-ignore */ configUrl.href
      );

      expect(importedConfig).toMatchObject({
        default: {
          dbCredentials: {
            database: 'evorto staging',
            host: '10.0.0.8',
            password: 'p@ss/word',
            port: 6432,
            ssl: {
              ca: caCertificate,
              checkServerIdentity: expect.any(Function),
              rejectUnauthorized: true,
            },
            user: 'schema_owner',
          },
          dialect: 'postgresql',
        },
      });
    } finally {
      for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) {
          Reflect.deleteProperty(process.env, key);
        } else {
          process.env[key] = value;
        }
      }
    }

    const containers = source(
      'infrastructure/scaleway/modules/environment/containers.tf',
    );
    expect(containers).not.toContain('DATABASE_TLS_SERVER_NAME');
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
      'locals {\n  worker_triggers',
    );

    expect(roles).toContain("['web', 'worker', 'ops']");
    expect(containers).toContain('APP_BOOTSTRAP                    = "true"');
    expect(containers.match(/cpu_limit\s+= 560/gu)).toHaveLength(3);
    expect(containers).toContain('container_memory_limit_bytes = 1073000000');
    expect(
      containers.match(
        /memory_limit_bytes\s+= local\.container_memory_limit_bytes/gu,
      ),
    ).toHaveLength(3);
    expect(containers.match(/private_network_id\s+=/gu)).toHaveLength(3);
    expect(containers).not.toMatch(/^\s+PORT\s+=/gmu);
    expect(
      containers.match(/startup_probe \{[\s\S]*?interval\s+= "5s"/gu),
    ).toHaveLength(3);
    expect(web).toContain('privacy                = "public"');
    expect(web).toContain('max_scale              = 3');
    expect(web.match(/path = "\/readyz"/gu)).toHaveLength(1);
    expect(web.match(/path = "\/healthz"/gu)).toHaveLength(1);
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
    expect(server).toMatch(
      /registrationRefundWorkerRuntimeModeConfig\s*\.parse\(requestHandlerRuntimeConfigProvider\)/u,
    );
    expect(server).toContain(
      'launchRegistrationRefundWorker(\n          registrationRefundWorkerMode,',
    );
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
    const main = source('infrastructure/scaleway/main.tf');
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
    expect(storage).toContain('prefix  = "receipt-uploads/"');
    expect(storage).toContain('prefix  = "source-maps/"');
    expect(storage).toContain('days = 90');
    expect(storage).toContain(
      'SCW = "application_id:${var.management_application_id}"',
    );
    expect(storage).toContain('Action = "s3:*"');
    expect(storage).toContain('Sid    = "ConsoleBucketReadAccess"');
    expect(storage).toContain('Sid    = "ConsoleObjectReadAccess"');
    expect(storage).toContain('"user_id:${user_id}"');
    expect(storage).toContain('"s3:ListBucket"');
    expect(storage).toContain('"s3:GetObject"');
    expect(storage).not.toMatch(
      /Console(?:Bucket|Object)ReadAccess[\s\S]*?"s3:(?:Put|Delete)/u,
    );
    expect(storage).toContain('scaleway_object_bucket_acl.application,');
    expect(
      main.match(
        /management_application_id\s+= scaleway_iam_application\.deployer\.id/gu,
      ),
    ).toHaveLength(2);
    for (const workflow of [
      source('.github/workflows/scaleway-staging.yml'),
      source('.github/workflows/scaleway-production.yml'),
    ]) {
      expect(workflow).toContain(
        'TF_VAR_application_bucket_console_user_ids: ${{ vars.APPLICATION_BUCKET_CONSOLE_USER_IDS }}',
      );
    }
    expect(bootstrap).toContain('prevent_destroy = true');
    expect(bootstrap).toContain('acl        = "private"');
    expect(bootstrap).toContain('sse_algorithm = "AES256"');
    expect(versions).toContain('use_lockfile                = true');
  });

  it('reconciles unproxied Scaleway application and email records through Cloudflare', () => {
    const dns = source('infrastructure/scaleway/dns.tf');
    const outputs = source('infrastructure/scaleway/outputs.tf');
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');
    const transactionalEmail = source(
      'infrastructure/scaleway/transactional-email.tf',
    );
    const versions = source('infrastructure/scaleway/versions.tf');

    expect(versions).toContain('source  = "cloudflare/cloudflare"');
    expect(versions).toContain('version = "= 5.22.0"');
    expect(dns).toContain('resource "cloudflare_dns_record" "staging"');
    expect(dns).toContain('resource "cloudflare_dns_record" "production"');
    expect(dns).toContain('resource "scaleway_container_domain" "staging_web"');
    expect(dns).toContain(
      'resource "scaleway_container_domain" "production_web"',
    );
    expect(dns).toContain('depends_on = [cloudflare_dns_record.staging]');
    expect(dns).toContain('depends_on = [cloudflare_dns_record.production]');
    expect(dns).toContain(
      'from = module.staging.scaleway_container_domain.web',
    );
    expect(dns).toContain(
      'resource "cloudflare_dns_record" "transactional_email"',
    );
    expect(dns.match(/proxied\s+= false/gu)).toHaveLength(3);
    expect(dns).toContain('scaleway_tem_domain.notifications.spf_value');
    expect(dns).not.toContain('scaleway_tem_domain.notifications.spf_config');
    expect(dns).toContain('content  = trimsuffix(local.tem_mx_parts[1], ".")');
    expect(dns).toContain('priority = tonumber(local.tem_mx_parts[0])');
    expect(outputs).toContain('output "managed_dns_records"');
    expect(outputs).toContain('scaleway_tem_domain.notifications.spf_value');
    expect(transactionalEmail).toContain(
      'depends_on = [cloudflare_dns_record.transactional_email]',
    );
    for (const workflow of [staging, production]) {
      expect(workflow).toContain(
        'TF_VAR_cloudflare_zone_id: ${{ vars.CLOUDFLARE_ZONE_ID }}',
      );
      expect(workflow).toContain(
        'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
      );
    }
  });

  it('declares role-scoped secret names without putting values in Terraform state', () => {
    const secrets = source(
      'infrastructure/scaleway/modules/environment/secrets.tf',
    );
    const containers = source(
      'infrastructure/scaleway/modules/environment/containers.tf',
    );
    const outputs = source(
      'infrastructure/scaleway/modules/environment/outputs.tf',
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
    expect(outputs).toContain('key => trimprefix(secret.id, "${var.region}/")');
    expect(outputs).not.toContain('key => secret.id');
  });

  it('uses native container telemetry, custom traces, all provider alerts, and release-aware logs', () => {
    const observability = source(
      'infrastructure/scaleway/modules/environment/observability.tf',
    );
    const logger = source('src/server/effect/server-logger.layer.ts');
    const main = source('infrastructure/scaleway/main.tf');

    expect(observability).toContain('type           = "traces"');
    expect(observability).not.toContain('type           = "logs"');
    expect(observability).not.toContain('type           = "metrics"');
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
    expect(deployRole).toContain(
      'container_id="${container_resource_id#"${region}/"}"',
    );
    expect(deployRole).toContain('region="${region}"');
    expect(deployRole).toContain('Failed to update the ${role} container');
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
