import { Effect, Option, Redacted, Schema } from 'effect';

import type { DeploymentConfig } from '../config/deployment-config';

export class RuntimeRoleConfigurationError extends Schema.TaggedErrorClass<RuntimeRoleConfigurationError>()(
  'RuntimeRoleConfigurationError',
  {
    message: Schema.String,
  },
) {}

const failConfiguration = (message: string) =>
  Effect.fail(new RuntimeRoleConfigurationError({ message }));

export const validateRuntimeRoleConfiguration = (
  deployment: DeploymentConfig,
) =>
  Effect.gen(function* () {
    const isPlatformEnvironment = deployment.APP_ENVIRONMENT !== 'local';
    if (deployment.APP_BOOTSTRAP) {
      if (!isPlatformEnvironment) {
        return yield* failConfiguration(
          'APP_BOOTSTRAP is reserved for the initial platform container deployment',
        );
      }

      return {
        bootstrap: true as const,
        environment: deployment.APP_ENVIRONMENT,
        role: deployment.APP_ROLE,
        schemaHash: undefined,
        triggerMode: deployment.WORKER_TRIGGER_MODE,
      };
    }

    if (
      deployment.APP_ROLE === 'worker' &&
      isPlatformEnvironment &&
      deployment.WORKER_TRIGGER_MODE !== 'http'
    ) {
      return yield* failConfiguration(
        'Non-local workers must use WORKER_TRIGGER_MODE=http',
      );
    }

    const schemaHash = Option.getOrUndefined(deployment.APP_SCHEMA_HASH);
    if (
      deployment.APP_ROLE === 'ops' &&
      (!schemaHash || !/^[0-9a-f]{64}$/u.test(schemaHash))
    ) {
      return yield* failConfiguration(
        'APP_SCHEMA_HASH must be the lowercase SHA-256 of the packaged schema for the ops role',
      );
    }

    const tracesEndpoint = Option.getOrUndefined(
      deployment.COCKPIT_TRACES_ENDPOINT,
    );
    const tracesToken = Option.getOrUndefined(deployment.COCKPIT_TRACES_TOKEN);

    if (isPlatformEnvironment && (!tracesEndpoint || !tracesToken)) {
      return yield* failConfiguration(
        'COCKPIT_TRACES_ENDPOINT and COCKPIT_TRACES_TOKEN are required outside local development',
      );
    }

    if (
      tracesEndpoint &&
      (tracesEndpoint.protocol !== 'https:' ||
        !tracesEndpoint.hostname.endsWith('.traces.cockpit.fr-par.scw.cloud') ||
        tracesEndpoint.pathname !== '/otlp/v1/traces')
    ) {
      return yield* failConfiguration(
        'COCKPIT_TRACES_ENDPOINT must be the fr-par HTTPS OTLP traces push endpoint',
      );
    }

    if (tracesToken && Redacted.value(tracesToken).length < 32) {
      return yield* failConfiguration(
        'COCKPIT_TRACES_TOKEN must contain at least 32 characters',
      );
    }

    if (
      deployment.APP_ROLE === 'web' &&
      isPlatformEnvironment &&
      !deployment.TRUST_PLATFORM_PROXY
    ) {
      return yield* failConfiguration(
        'TRUST_PLATFORM_PROXY must be enabled for non-local web containers',
      );
    }

    const readinessTenantHost = Option.getOrUndefined(
      deployment.READINESS_TENANT_HOST,
    );
    if (
      deployment.APP_ROLE === 'web' &&
      isPlatformEnvironment &&
      !readinessTenantHost
    ) {
      return yield* failConfiguration(
        'READINESS_TENANT_HOST is required for non-local web containers',
      );
    }

    const revision = Option.getOrUndefined(deployment.APP_REVISION);
    if (
      isPlatformEnvironment &&
      (!revision || !/^[0-9a-f]{40}$/u.test(revision))
    ) {
      return yield* failConfiguration(
        'APP_REVISION must be the full lowercase Git SHA outside local development',
      );
    }

    const imageDigest = Option.getOrUndefined(deployment.APP_IMAGE_DIGEST);
    if (
      isPlatformEnvironment &&
      (!imageDigest || !/^sha256:[0-9a-f]{64}$/u.test(imageDigest))
    ) {
      return yield* failConfiguration(
        'APP_IMAGE_DIGEST must be a sha256 digest outside local development',
      );
    }

    return {
      bootstrap: false as const,
      environment: deployment.APP_ENVIRONMENT,
      imageDigest,
      readinessTenantHost,
      revision,
      role: deployment.APP_ROLE,
      schemaHash,
      triggerMode: deployment.WORKER_TRIGGER_MODE,
    };
  });
