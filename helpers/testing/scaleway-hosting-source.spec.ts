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
    const server = source('src/server.ts');
    const seoMetadata = source('src/server/http/seo-metadata.web-handler.ts');

    for (const removedPath of [
      '.github/workflows/fly-deploy.yml',
      'fly.toml',
    ]) {
      expect(existsSync(path.join(repositoryRoot, removedPath))).toBe(false);
    }

    for (const currentSource of [
      source('angular.json'),
      source('src/db/setup-database.ts'),
      seoMetadata,
    ]) {
      expect(currentSource).not.toContain('evorto.fly.dev');
    }
    expect(seoMetadata).not.toContain('alpha.evorto.app');
    expect(server).toContain('robotsRouteLayer');
    expect(server).toContain('sitemapRouteLayer');
    expect(existsSync(path.join(repositoryRoot, 'public/robots.txt'))).toBe(
      false,
    );
    expect(existsSync(path.join(repositoryRoot, 'public/sitemap.xml'))).toBe(
      false,
    );
  });

  it('isolates every Terraform root behind its own state identity and bucket', () => {
    const bootstrap = source('infrastructure/scaleway/bootstrap/versions.tf');
    const bootstrapIam = source('infrastructure/scaleway/bootstrap/iam.tf');
    const bootstrapMain = source('infrastructure/scaleway/bootstrap/main.tf');
    const bootstrapOutputs = source(
      'infrastructure/scaleway/bootstrap/outputs.tf',
    );
    const bootstrapVariables = source(
      'infrastructure/scaleway/bootstrap/variables.tf',
    );
    const stagingVersions = source(
      'infrastructure/scaleway/staging/versions.tf',
    );
    const productionVersions = source(
      'infrastructure/scaleway/production/versions.tf',
    );
    const stagingMain = source('infrastructure/scaleway/staging/main.tf');
    const productionMain = source('infrastructure/scaleway/production/main.tf');
    const staging = source('.github/workflows/scaleway-staging.yml');
    const stagingReset = source('.github/workflows/scaleway-staging-reset.yml');
    const production = source('.github/workflows/scaleway-production.yml');
    const quality = source('.github/workflows/pr-quality.yml');
    const verification = source('ops/scaleway/verify-terraform.sh');

    for (const removedMixedRoot of [
      'infrastructure/scaleway/main.tf',
      'infrastructure/scaleway/dns.tf',
      'infrastructure/scaleway/variables.tf',
      'infrastructure/scaleway/outputs.tf',
      'infrastructure/scaleway/versions.tf',
    ]) {
      expect(existsSync(path.join(repositoryRoot, removedMixedRoot))).toBe(
        false,
      );
    }

    expect(bootstrap).toContain(
      'key                         = "evorto/bootstrap.tfstate"',
    );
    expect(stagingVersions).toContain(
      'key                         = "evorto/staging.tfstate"',
    );
    expect(productionVersions).toContain(
      'key                         = "evorto/production.tfstate"',
    );
    expect(
      existsSync(
        path.join(
          repositoryRoot,
          'infrastructure/scaleway/backend.hcl.example',
        ),
      ),
    ).toBe(false);
    for (const root of ['bootstrap', 'staging', 'production'] as const) {
      const backendExample = source(
        `infrastructure/scaleway/${root}/backend.hcl.example`,
      );
      expect(backendExample).toContain(
        `evorto-terraform-state-${root}-replace-with-unique-suffix`,
      );
      expect(backendExample).not.toMatch(/^\s*key\s*=/mu);
      expect(bootstrapMain).toMatch(
        new RegExp(`bucket_name\\s+= var\\.state_bucket_names\\.${root}`, 'u'),
      );
      expect(bootstrapOutputs).toContain(
        `scaleway_object_bucket.terraform_state["${root}"].name`,
      );
      expect(bootstrapIam).toContain(
        `resource "scaleway_iam_application" "${root}_terraform_state"`,
      );
      expect(bootstrapIam).toContain(
        `resource "scaleway_iam_policy" "${root}_terraform_state"`,
      );
    }
    expect(bootstrapVariables).toContain(
      'length(toset(values(var.state_bucket_names))) == 3',
    );
    expect(bootstrapMain).toContain(
      'for_each = local.terraform_state_backends',
    );
    expect(bootstrapMain).toContain(
      'SCW = "application_id:${each.value.application_id}"',
    );
    expect(
      between(
        bootstrapIam,
        'resource "scaleway_iam_policy" "bootstrap_terraform_state"',
        'resource "scaleway_iam_policy" "staging_terraform_state"',
      ),
    ).toContain('project_ids          = [var.bootstrap_project_id]');
    expect(
      between(
        bootstrapIam,
        'resource "scaleway_iam_policy" "staging_terraform_state"',
        'resource "scaleway_iam_policy" "production_terraform_state"',
      ),
    ).toContain('project_ids          = [scaleway_account_project.staging.id]');
    expect(
      between(
        bootstrapIam,
        'resource "scaleway_iam_policy" "production_terraform_state"',
        'resource "scaleway_iam_application" "staging_deployer"',
      ),
    ).toContain(
      'project_ids          = [scaleway_account_project.production.id]',
    );
    expect(stagingMain).toMatch(/environment\s+= "staging"/u);
    expect(stagingMain).not.toMatch(/environment\s+= "production"/u);
    expect(stagingMain).not.toContain('alpha.evorto.app');
    expect(productionMain).toMatch(/environment\s+= "production"/u);
    expect(productionMain).toMatch(/hostname\s+= "alpha\.evorto\.app"/u);
    expect(staging).toContain(
      'terraform -chdir=infrastructure/scaleway/staging',
    );
    expect(staging).not.toContain(
      'terraform -chdir=infrastructure/scaleway/production',
    );
    expect(production).toContain(
      'terraform -chdir=infrastructure/scaleway/production',
    );
    expect(production).not.toContain(
      'terraform -chdir=infrastructure/scaleway/staging',
    );
    for (const stagingWorkflow of [staging, stagingReset]) {
      expect(stagingWorkflow).toContain(
        '${{ secrets.STAGING_TERRAFORM_STATE_ACCESS_KEY_ID }}',
      );
      expect(stagingWorkflow).toContain(
        '${{ secrets.STAGING_TERRAFORM_STATE_SECRET_ACCESS_KEY }}',
      );
      expect(stagingWorkflow).toContain(
        '${{ vars.STAGING_TERRAFORM_STATE_BUCKET }}',
      );
      expect(stagingWorkflow).not.toContain(
        '${{ secrets.TERRAFORM_STATE_ACCESS_KEY_ID }}',
      );
      expect(stagingWorkflow).not.toContain(
        '${{ secrets.TERRAFORM_STATE_SECRET_ACCESS_KEY }}',
      );
      expect(stagingWorkflow).not.toContain(
        '${{ vars.TERRAFORM_STATE_BUCKET }}',
      );
      expect(stagingWorkflow).not.toContain(
        'PRODUCTION_TERRAFORM_STATE_ACCESS_KEY_ID',
      );
    }
    expect(production).toContain(
      '${{ secrets.PRODUCTION_TERRAFORM_STATE_ACCESS_KEY_ID }}',
    );
    expect(production).toContain(
      '${{ secrets.PRODUCTION_TERRAFORM_STATE_SECRET_ACCESS_KEY }}',
    );
    expect(production).toContain(
      '${{ vars.PRODUCTION_TERRAFORM_STATE_BUCKET }}',
    );
    expect(production).not.toContain(
      '${{ secrets.TERRAFORM_STATE_ACCESS_KEY_ID }}',
    );
    expect(production).not.toContain(
      '${{ secrets.TERRAFORM_STATE_SECRET_ACCESS_KEY }}',
    );
    expect(production).not.toContain('${{ vars.TERRAFORM_STATE_BUCKET }}');
    expect(production).not.toContain('STAGING_TERRAFORM_STATE_ACCESS_KEY_ID');
    for (const productionRuntimeVariable of [
      'TF_VAR_production_enabled',
      'TF_VAR_production_container_image',
      'TF_VAR_production_runtime_database_password',
      'TF_VAR_production_schema_database_password',
    ]) {
      expect(staging).not.toContain(productionRuntimeVariable);
    }
    expect(production).not.toContain('TF_VAR_staging_');
    expect(production).not.toContain('STAGING_RUNTIME_DATABASE_PASSWORD');
    expect(production).not.toContain('STAGING_SCHEMA_DATABASE_PASSWORD');
    expect(staging).not.toContain('-target=');
    expect(production).not.toContain('-target=');
    for (const root of ['bootstrap', 'staging', 'production']) {
      expect(quality).toContain('for root in bootstrap staging production; do');
      expect(verification).toContain(`infrastructure/scaleway/${root}`);
    }
    for (const root of [bootstrap, stagingVersions, productionVersions]) {
      expect(root).not.toContain('terraform_remote_state');
    }
    for (const root of [stagingMain, productionMain]) {
      expect(root).not.toContain('count =');
      expect(root).not.toContain('coalesce(');
      expect(root).not.toContain('moved {');
    }
    expect(production).toContain("if: vars.PRODUCTION_ENABLED == 'true'");
    expect(production).toContain('CONFIRMATION: ${{ inputs.confirmation }}');
    expect(production).toContain(
      'if [ "${CONFIRMATION}" != "promote-alpha" ]; then',
    );
    expect(production).not.toContain('pull_request_target:');
  });

  it('provisions private PostgreSQL 17 with separate runtime and schema users', () => {
    const stagingMain = source('infrastructure/scaleway/staging/main.tf');
    const productionMain = source('infrastructure/scaleway/production/main.tf');
    const database = source(
      'infrastructure/scaleway/modules/environment/database.tf',
    );
    const outputs = source(
      'infrastructure/scaleway/modules/environment/outputs.tf',
    );
    const moduleVariables = source(
      'infrastructure/scaleway/modules/environment/variables.tf',
    );
    const stagingVariables = source(
      'infrastructure/scaleway/staging/variables.tf',
    );
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');
    const bootstrapIam = source('infrastructure/scaleway/bootstrap/iam.tf');

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
    expect(database).toMatch(
      /resource "scaleway_rdb_privilege" "schema" \{[^}]*user_name\s+= scaleway_rdb_instance\.application\.user_name[^}]*permission\s+= "all"/u,
    );
    expect(database).toMatch(
      /resource "scaleway_rdb_privilege" "runtime" \{[^}]*user_name\s+= scaleway_rdb_user\.runtime\.name[^}]*permission\s+= "readwrite"/u,
    );
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
    expect(stagingVariables).toContain(
      'variable "schema_database_password_version"',
    );
    expect(stagingVariables).toContain(
      'variable "runtime_database_password_version"',
    );
    expect(stagingMain).toMatch(
      /schema_database_password_version\s+= var\.schema_database_password_version/u,
    );
    expect(stagingMain).toMatch(
      /runtime_database_password_version\s+= var\.runtime_database_password_version/u,
    );
    expect(staging).toContain(
      'TF_VAR_schema_database_password_version: ${{ vars.SCHEMA_DATABASE_PASSWORD_VERSION }}',
    );
    expect(staging).toContain(
      'TF_VAR_runtime_database_password_version: ${{ vars.RUNTIME_DATABASE_PASSWORD_VERSION }}',
    );
    expect(production).toContain(
      'TF_VAR_schema_database_password_version: ${{ vars.PRODUCTION_SCHEMA_DATABASE_PASSWORD_VERSION }}',
    );
    expect(production).toContain(
      'TF_VAR_runtime_database_password_version: ${{ vars.PRODUCTION_RUNTIME_DATABASE_PASSWORD_VERSION }}',
    );
    expect(stagingMain).toMatch(/database_node_type\s+= "DB-DEV-S"/u);
    expect(stagingMain).toMatch(/database_backup_retention_days\s+= 7/u);
    expect(productionMain).toMatch(/database_node_type\s+= "DB-POP2-2C-8G"/u);
    expect(productionMain).toMatch(/database_is_ha\s+= true/u);
    expect(productionMain).toMatch(/database_backup_retention_days\s+= 30/u);
    expect(bootstrapIam).toContain('"IPAMReadOnly"');
    expect(database).toContain('prevent_destroy = true');
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
    expect(containers).toContain(
      'SSR_RPC_ORIGIN        = "http://127.0.0.1:4200"',
    );
    for (const privateRole of [worker, ops]) {
      expect(privateRole).toContain('privacy                = "private"');
      expect(privateRole).toContain('min_scale              = 0');
      expect(privateRole).toContain('max_scale              = 1');
    }
    expect(worker.match(/path = "\/readyz"/gu)).toHaveLength(1);
    expect(worker.match(/path = "\/healthz"/gu)).toHaveLength(1);
    expect(ops.match(/path = "\/healthz"/gu)).toHaveLength(2);
    expect(source('infrastructure/scaleway/staging/main.tf')).toMatch(
      /web_min_scale\s+= 0/u,
    );
    expect(source('infrastructure/scaleway/production/main.tf')).toMatch(
      /web_min_scale\s+= 1/u,
    );
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
    const stagingMain = source('infrastructure/scaleway/staging/main.tf');
    const productionMain = source('infrastructure/scaleway/production/main.tf');
    const storage = source(
      'infrastructure/scaleway/modules/environment/storage.tf',
    );
    const bootstrap = source('infrastructure/scaleway/bootstrap/main.tf');
    const bootstrapIam = source('infrastructure/scaleway/bootstrap/iam.tf');
    const versions = source('infrastructure/scaleway/staging/versions.tf');

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
    expect(storage).toContain('"application_id:${var.web_application_id}"');
    expect(storage).toContain('"application_id:${var.worker_application_id}"');
    expect(storage).not.toContain('resource "scaleway_iam_application"');
    expect(storage).not.toContain('resource "scaleway_iam_policy"');
    expect(storage).toContain('Action = "s3:*"');
    expect(storage).toContain('Sid    = "PromotionReadAccess"');
    expect(storage).toContain(
      'for application_id in var.deployment_metadata_reader_application_ids',
    );
    expect(storage).toContain('"s3:ListBucket"');
    expect(storage).toContain('"s3:GetObject"');
    expect(storage).not.toContain('user_id:');
    expect(storage).toContain('scaleway_object_bucket_acl.application,');
    for (const main of [stagingMain, productionMain]) {
      expect(main).toMatch(
        /management_application_id\s+= var\.deployer_application_id/u,
      );
      expect(main).toMatch(/web_application_id\s+= var\.web_application_id/u);
      expect(main).toMatch(
        /worker_application_id\s+= var\.worker_application_id/u,
      );
    }
    expect(bootstrapIam).not.toContain('IAMManager');
    expect(bootstrapIam).not.toContain('BillingManager');
    expect(bootstrapIam).not.toContain('scaleway_iam_application" "ops');
    for (const permissionSet of [
      'ObjectStorageBucketsRead',
      'ObjectStorageObjectsDelete',
      'ObjectStorageObjectsRead',
      'ObjectStorageObjectsWrite',
    ]) {
      expect(bootstrapIam, permissionSet).toContain(`"${permissionSet}"`);
    }
    expect(bootstrapIam).toContain('"ContainerRegistryReadOnly"');
    expect(bootstrapIam).toContain(
      'project_ids          = [scaleway_account_project.staging.id]',
    );
    for (const workflow of [
      source('.github/workflows/scaleway-staging.yml'),
      source('.github/workflows/scaleway-production.yml'),
    ]) {
      expect(workflow).toContain(
        'TF_VAR_deployer_application_id: ${{ vars.SCW_DEPLOYER_APPLICATION_ID }}',
      );
      expect(workflow).toContain(
        'TF_VAR_web_application_id: ${{ vars.SCW_WEB_APPLICATION_ID }}',
      );
      expect(workflow).toContain(
        'TF_VAR_worker_application_id: ${{ vars.SCW_WORKER_APPLICATION_ID }}',
      );
    }
    expect(source('.github/workflows/scaleway-staging.yml')).toContain(
      'TF_VAR_production_deployer_application_id: ${{ vars.SCW_PRODUCTION_DEPLOYER_APPLICATION_ID }}',
    );
    expect(bootstrap.match(/prevent_destroy = true/gu)).toHaveLength(3);
    expect(bootstrap).toContain('acl        = "private"');
    expect(bootstrap).toContain('sse_algorithm = "AES256"');
    expect(versions).toContain('use_lockfile                = true');
    const moduleOutputs = source(
      'infrastructure/scaleway/modules/environment/outputs.tf',
    );
    expect(moduleOutputs).not.toContain('role_application_ids');
    expect(moduleOutputs).not.toContain('registry_endpoint');
    for (const environment of ['staging', 'production']) {
      const rootOutputs = source(
        `infrastructure/scaleway/${environment}/outputs.tf`,
      );
      expect(rootOutputs).toContain('output "platform"');
      expect(rootOutputs).toContain('output "database"');
    }
  });

  it('reconciles unproxied Scaleway application and email records through Cloudflare', () => {
    const bootstrapDns = source('infrastructure/scaleway/bootstrap/dns.tf');
    const stagingDns = source('infrastructure/scaleway/staging/dns.tf');
    const productionDns = source('infrastructure/scaleway/production/dns.tf');
    const bootstrapOutputs = source(
      'infrastructure/scaleway/bootstrap/outputs.tf',
    );
    const stagingOutputs = source('infrastructure/scaleway/staging/outputs.tf');
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');
    const transactionalEmail = source(
      'infrastructure/scaleway/bootstrap/transactional-email.tf',
    );
    const versions = source('infrastructure/scaleway/staging/versions.tf');

    expect(versions).toContain('source  = "cloudflare/cloudflare"');
    expect(versions).toContain('version = "= 5.22.0"');
    expect(stagingDns).toContain('resource "cloudflare_dns_record" "web"');
    expect(productionDns).toContain('resource "cloudflare_dns_record" "web"');
    expect(stagingDns).toContain('resource "scaleway_container_domain" "web"');
    expect(productionDns).toContain(
      'resource "scaleway_container_domain" "web"',
    );
    expect(stagingDns).toContain('depends_on = [cloudflare_dns_record.web]');
    expect(productionDns).toContain('depends_on = [cloudflare_dns_record.web]');
    expect(bootstrapDns).not.toContain('moved {');
    expect(stagingDns).not.toContain('moved {');
    expect(productionDns).not.toContain('moved {');
    expect(bootstrapDns).toContain(
      'resource "cloudflare_dns_record" "transactional_email"',
    );
    expect(
      [bootstrapDns, stagingDns, productionDns]
        .join('\n')
        .match(/proxied\s+= false/gu),
    ).toHaveLength(3);
    expect(bootstrapDns).toContain(
      'scaleway_tem_domain.notifications.spf_value',
    );
    expect(bootstrapDns).not.toContain(
      'scaleway_tem_domain.notifications.spf_config',
    );
    expect(bootstrapDns).toContain(
      'content  = trimsuffix(local.tem_mx_parts[1], ".")',
    );
    expect(bootstrapDns).toContain(
      'priority = tonumber(local.tem_mx_parts[0])',
    );
    expect(bootstrapOutputs).toContain(
      'output "managed_transactional_email_dns_records"',
    );
    expect(bootstrapOutputs).toContain(
      'scaleway_tem_domain.notifications.spf_value',
    );
    expect(stagingOutputs).toContain('output "managed_dns_record"');
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
    const containers = source(
      'infrastructure/scaleway/modules/environment/containers.tf',
    );
    const moduleVariables = source(
      'infrastructure/scaleway/modules/environment/variables.tf',
    );
    const observability = source(
      'infrastructure/scaleway/modules/environment/observability.tf',
    );
    const logger = source('src/server/effect/server-logger.layer.ts');
    const bootstrap = source('infrastructure/scaleway/bootstrap/main.tf');

    expect(observability).toContain('type           = "traces"');
    expect(observability).not.toContain('type           = "logs"');
    expect(observability).not.toContain('type           = "metrics"');
    expect(containers).toMatch(/TRACE_SAMPLING_RATIO\s+= "0\.1"/u);
    expect(moduleVariables).toMatch(
      /variable "cockpit_trace_retention_days" \{[\s\S]*?default\s+= 7/u,
    );
    expect(observability).toContain(
      'preconfigured_alert_ids = toset(data.scaleway_cockpit_preconfigured_alert.available.alerts[*].preconfigured_rule_id)',
    );
    expect(observability).toContain('email = var.alert_email');
    expect(bootstrap).toContain(
      'resource "scaleway_billing_budget" "organization"',
    );
    for (const annotation of [
      'environment:',
      'imageDigest:',
      'revision:',
      'role:',
    ]) {
      expect(logger, annotation).toContain(annotation);
    }
  });

  it('smokes rendered event routes and the Effect RPC protocol contract', () => {
    const stagingSmoke = between(
      source('.github/workflows/scaleway-staging.yml'),
      '- name: Verify staging revision, readiness, tenancy, Auth0, RPC, and noindex',
      '- name: Write append-only successful deployment manifest',
    );
    const productionSmoke = between(
      source('.github/workflows/scaleway-production.yml'),
      '- name: Smoke the promoted production release',
      '- name: Write append-only production deployment manifest',
    );

    expect(stagingSmoke).toContain('https://staging.evorto.app/events');
    expect(stagingSmoke).toContain('rpc_body="$(');
    expect(stagingSmoke).toContain('curl "${curl_args[@]}"');
    expect(stagingSmoke).toContain(
      '"tag":"config.isAuthenticated","payload":null',
    );
    expect(stagingSmoke).toContain('.[0]._tag == "Exit"');
    expect(stagingSmoke).toContain('.[0].exit._tag == "Success"');
    expect(stagingSmoke).toContain('.[0].exit.value == false');
    expect(stagingSmoke).not.toContain('._tag == "Defect"');
    expect(stagingSmoke).not.toContain('rpc_status=');
    expect(productionSmoke).toContain('https://alpha.evorto.app/events');
  });

  it('builds once, records immutable evidence, and promotes the exact OCI digest', () => {
    const staging = source('.github/workflows/scaleway-staging.yml');
    const production = source('.github/workflows/scaleway-production.yml');
    const quality = source('.github/workflows/pr-quality.yml');
    const deployRole = source('ops/scaleway/deploy-role.sh');
    const localImageSecurity = source('ops/scaleway/verify-image-security.sh');
    const stagingScan = between(
      staging,
      '- name: Scan exact deployed image digest',
      '- name: Verify staging infrastructure has no pending changes',
    );
    const productionScan = between(
      production,
      '- name: Scan exact promoted image digest',
      '- name: Verify production infrastructure has no pending changes',
    );

    expect(staging).toContain('workflow_run:');
    expect(staging).not.toContain('schedule:');
    expect(staging).not.toContain('cron:');
    expect(staging).toContain('full_trace_debugging:');
    expect(staging).toContain(
      "TRACE_SAMPLING_RATIO_OVERRIDE: ${{ inputs.full_trace_debugging && '1' || '' }}",
    );
    expect(staging).toContain('cancel-in-progress: false');
    expect(staging).toContain('ops/scaleway/require-release-gates.sh');
    expect(staging).toContain('--platform linux/amd64');
    expect(staging).toContain('--provenance=mode=max');
    expect(staging).toContain("--if-none-match '*'");
    expect(staging).toContain('/internal/ops/schema-explain');
    expect(staging).toContain('\'{"mode":"initialize-empty"}\'');
    expect(staging).toContain('-detailed-exitcode');
    expect(staging).not.toContain('terraform apply');
    expect(staging).not.toContain('previous.json');
    expect(staging).not.toContain('rollback');
    expect(staging).toContain(
      'curl_args=(--connect-timeout 5 --max-time 20 --silent --show-error)',
    );

    expect(production).not.toContain('docker build ');
    expect(production).not.toContain('docker buildx build ');
    expect(production).toContain('docker buildx imagetools create');
    expect(production).toContain('docker buildx imagetools inspect --raw');
    expect(production).toContain(
      'if [ "${target_digest}" != "${SOURCE_DIGEST}" ]; then',
    );
    expect(production).toContain('sourceStagingManifestKey:');
    expect(production).toContain('-detailed-exitcode');
    expect(production).not.toContain('terraform apply');
    expect(production).not.toContain('previous.json');
    expect(production).not.toContain('rollback');
    expect(production).toContain(
      'curl_args=(--connect-timeout 5 --max-time 20 --silent --show-error)',
    );
    expect(deployRole).toContain('APP_BOOTSTRAP: "false"');
    expect(deployRole).toContain('APP_DEPLOYMENT_FINGERPRINT');
    expect(deployRole).toContain('TRACE_SAMPLING_RATIO_OVERRIDE');
    expect(deployRole).toContain(
      'TRACE_SAMPLING_RATIO: $trace_sampling_ratio_override',
    );
    expect(deployRole).toContain(
      'container_id="${container_resource_id#"${region}/"}"',
    );
    expect(deployRole).toContain('container container get');
    expect(deployRole).toContain('region="${region}"');
    expect(deployRole).toContain('Failed to update the ${role} container');
    expect(staging).toContain('workflows: [E2E Baseline]');
    expect(staging).not.toContain('workflows: [PR Quality, E2E Baseline]');
    expect(staging).toContain(
      'Ops already matches the desired release; skipping schema reconciliation.',
    );
    expect(stagingScan).toContain(
      'image-ref: ${{ steps.image.outputs.reference }}',
    );
    expect(stagingScan).not.toContain('if: steps.reuse.outputs.reuse');
    expect(productionScan).toContain(
      'image-ref: ${{ steps.image.outputs.reference }}',
    );
    expect(production.indexOf('Scan exact promoted image digest')).toBeLessThan(
      production.indexOf(
        'Verify production infrastructure has no pending changes',
      ),
    );
    for (const vulnerabilityGate of [
      stagingScan,
      productionScan,
      quality,
      localImageSecurity,
    ]) {
      expect(vulnerabilityGate).not.toContain('ignore-unfixed');
    }
  });

  it('provides worker email delivery at the HTTP request boundary', () => {
    const server = source('src/server.ts');
    const containers = source(
      'infrastructure/scaleway/modules/environment/containers.tf',
    );
    const worker = between(
      containers,
      'resource "scaleway_container" "worker"',
      'resource "scaleway_container" "ops"',
    );

    expect(server).toContain(
      'HttpLayerRouter.provideRequest(EmailDelivery.Default)',
    );
    expect(server).not.toContain('Layer.provide(EmailDelivery.Default)');
    expect(server).toContain('workerEmailDeliveryReadinessRouteLayer');
    expect(worker).toMatch(/startup_probe[\s\S]*?path = "\/readyz"/u);
    expect(worker).toMatch(/liveness_probe[\s\S]*?path = "\/healthz"/u);
  });

  it('bounds private ops calls before invoking schema or seed commands', () => {
    const invokePrivateContainer = source(
      'ops/scaleway/invoke-private-container.sh',
    );

    expect(invokePrivateContainer).toContain(
      '--connect-timeout "${connect_timeout_seconds}"',
    );
    expect(invokePrivateContainer).toContain(
      '--max-time "${maximum_time_seconds}"',
    );
  });

  it('documents the private one-time paid sign-up enablement safely', () => {
    const runbook = source('infrastructure/scaleway/README.md');
    const setupSection = between(
      runbook,
      '### Enable paid sign-ups for an organization',
      'The production workflow is dispatch-only',
    );

    expect(setupSection).toContain('read -r -s -p');
    expect(setupSection).toContain('/internal/worker/payment-setup');
    expect(setupSection).toContain('confirmation: "attach-payment-account"');
    expect(setupSection).toContain(
      'expectedOrganizationDomain: $expectedOrganizationDomain',
    );
    expect(setupSection).toContain('SCW_DEFAULT_PROJECT_ID');
    expect(setupSection).toContain('"${platform_output}"');
    expect(setupSection).toMatch(/"\$\{platform_output\}"\s+\\\s+worker/u);
    expect(setupSection).toContain('printf \'%s\' "${payment_account_id}" |');
    expect(setupSection).toContain('jq --raw-input --slurp');
    expect(setupSection).toContain('must not contain the payment account ID.');
    expect(setupSection).toContain('do not retry automatically');
    expect(setupSection).toContain(
      'replacement and removal are intentionally unsupported.',
    );
    expect(setupSection).not.toContain('Private worker endpoint:');
    expect(setupSection).not.toContain('${worker_endpoint}');
    expect(setupSection).not.toContain('--arg accountId');
    expect(setupSection).not.toContain('request_body');
    expect(setupSection).not.toContain('echo "${payment_account_id}"');
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
    expect(reset).toContain(
      'curl_args=(--connect-timeout 5 --max-time 20 --silent --show-error)',
    );
    expect(runtimeVerifier).toContain('maximum_size_bytes=1000000000');
    expect(runtimeVerifier).toContain("'api\\.resend\\.com|cloudflare[_-]r2");
    expect(runtimeVerifier).toContain('|@sentry|@neondatabase|resend)');
  });
});
