import {
  Config,
  ConfigProvider,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
} from 'effect';

import { optionalTrimmedString } from './config-string';

export const applicationEnvironmentConfig = Config.literals(
  ['local', 'staging', 'production'],
  'APP_ENVIRONMENT',
).pipe(Config.withDefault('local'));

export const applicationRoleConfig = Config.literals(
  ['web', 'worker', 'ops'],
  'APP_ROLE',
).pipe(Config.withDefault('web'));

export const workerTriggerModeConfig = Config.literals(
  ['poll', 'http'],
  'WORKER_TRIGGER_MODE',
).pipe(Config.withDefault('poll'));

const traceSamplingRatioConfig = Config.option(
  Config.finite('TRACE_SAMPLING_RATIO').pipe(
    Config.mapOrFail((ratio) =>
      ratio >= 0 && ratio <= 1
        ? Effect.succeed(ratio)
        : Effect.fail(
            new Config.ConfigError(
              new ConfigProvider.SourceError({
                message: `Expected TRACE_SAMPLING_RATIO to be between 0 and 1, got ${ratio}`,
              }),
            ),
          ),
    ),
  ),
);

const optionalRedactedString = (name: string) =>
  Config.option(Config.redacted(name)).pipe(
    Config.map(
      Option.map((value) => Redacted.make(Redacted.value(value).trim())),
    ),
    Config.map(
      Option.filter(
        (configuredValue) => Redacted.value(configuredValue).length > 0,
      ),
    ),
  );

const deploymentConfigState = Config.all({
  APP_BOOTSTRAP: Config.boolean('APP_BOOTSTRAP').pipe(
    Config.withDefault(false),
  ),
  APP_ENVIRONMENT: applicationEnvironmentConfig,
  APP_IMAGE_DIGEST: optionalTrimmedString('APP_IMAGE_DIGEST'),
  APP_REVISION: optionalTrimmedString('APP_REVISION'),
  APP_ROLE: applicationRoleConfig,
  APP_SCHEMA_HASH: optionalTrimmedString('APP_SCHEMA_HASH'),
  COCKPIT_TRACES_ENDPOINT: Config.option(Config.url('COCKPIT_TRACES_ENDPOINT')),
  COCKPIT_TRACES_TOKEN: optionalRedactedString('COCKPIT_TRACES_TOKEN'),
  E2E_GLOBAL_ADMIN_AUTH0_IDS: optionalTrimmedString(
    'E2E_GLOBAL_ADMIN_AUTH0_IDS',
  ),
  READINESS_TENANT_HOST: optionalTrimmedString('READINESS_TENANT_HOST'),
  TRACE_SAMPLING_RATIO: traceSamplingRatioConfig,
  TRUST_PLATFORM_PROXY: Config.boolean('TRUST_PLATFORM_PROXY').pipe(
    Config.withDefault(false),
  ),
  WORKER_TRIGGER_MODE: workerTriggerModeConfig,
});

export const deploymentConfig = deploymentConfigState.pipe(
  Config.mapOrFail(
    ({ E2E_GLOBAL_ADMIN_AUTH0_IDS: e2eGlobalAdminAuth0Ids, ...deployment }) =>
      deployment.APP_ENVIRONMENT !== 'local' &&
      Option.isSome(e2eGlobalAdminAuth0Ids)
        ? Effect.fail(
            new Config.ConfigError(
              new ConfigProvider.SourceError({
                message:
                  'E2E_GLOBAL_ADMIN_AUTH0_IDS is reserved for local test authorization and must not be configured in hosted environments',
              }),
            ),
          )
        : Effect.succeed(deployment),
  ),
);

export type DeploymentConfig = Config.Success<typeof deploymentConfig>;

export class DeploymentRuntimeConfig extends Context.Service<
  DeploymentRuntimeConfig,
  DeploymentConfig
>()('@server/config/DeploymentRuntimeConfig', {
  make: deploymentConfig,
}) {
  static readonly Default = Layer.effect(
    DeploymentRuntimeConfig,
    DeploymentRuntimeConfig.make,
  );
}
