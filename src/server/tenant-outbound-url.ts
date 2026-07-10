import {
  buildTenantOutboundUrl,
  resolveTenantOutboundRootUrl,
  type TenantOutboundRootUrlInput,
} from '@shared/tenant-public-url';
import { Effect, Option, Schema } from 'effect';

import { formatConfigError } from './config/config-error';
import { serverPublicUrlConfig } from './config/server-config';

export interface TenantOutboundUrlTenant {
  readonly canonicalRootUrl: string;
  readonly domain: string;
  readonly id?: string | undefined;
}

export class TenantOutboundUrlError extends Schema.TaggedErrorClass<TenantOutboundUrlError>()(
  'TenantOutboundUrlError',
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    tenantId: Schema.optional(Schema.String),
  },
) {}

const failTenantOutboundUrl = (
  tenant: TenantOutboundUrlTenant,
  message: string,
  cause?: unknown,
) =>
  new TenantOutboundUrlError({
    ...(cause !== undefined && { cause }),
    message,
    ...(tenant.id !== undefined && { tenantId: tenant.id }),
  });

const runtimeInput = (
  tenant: TenantOutboundUrlTenant,
  environment: {
    BASE_URL: Option.Option<string>;
    NODE_ENV: Option.Option<string>;
  },
): TenantOutboundRootUrlInput => ({
  canonicalRootUrl: tenant.canonicalRootUrl,
  domain: tenant.domain,
  localRuntimeOrigin: Option.getOrUndefined(environment.BASE_URL),
  nodeEnvironment: Option.getOrUndefined(environment.NODE_ENV),
});

export const tenantOutboundRootUrl = Effect.fn('tenantOutboundRootUrl')(
  function* (tenant: TenantOutboundUrlTenant) {
    const environment = yield* serverPublicUrlConfig.pipe(
      Effect.mapError((error) =>
        failTenantOutboundUrl(
          tenant,
          `Invalid server public URL configuration:\n${formatConfigError(error)}`,
          error,
        ),
      ),
    );

    return yield* Effect.try({
      catch: (cause) =>
        failTenantOutboundUrl(
          tenant,
          'Tenant canonical root URL is invalid',
          cause,
        ),
      try: () =>
        resolveTenantOutboundRootUrl(runtimeInput(tenant, environment)),
    });
  },
);

export const tenantOutboundUrl = Effect.fn('tenantOutboundUrl')(function* (
  tenant: TenantOutboundUrlTenant,
  path: string,
) {
  const environment = yield* serverPublicUrlConfig.pipe(
    Effect.mapError((error) =>
      failTenantOutboundUrl(
        tenant,
        `Invalid server public URL configuration:\n${formatConfigError(error)}`,
        error,
      ),
    ),
  );

  return yield* Effect.try({
    catch: (cause) =>
      failTenantOutboundUrl(
        tenant,
        'Tenant outbound URL could not be built',
        cause,
      ),
    try: () =>
      buildTenantOutboundUrl({
        ...runtimeInput(tenant, environment),
        path,
      }),
  });
});
