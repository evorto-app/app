import type * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest';

import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Effect, Option, Schema } from 'effect';

import type { AuthSession } from '../auth/auth-session';

import { Database } from '../../db';
import { localTestTenantDomainHeader } from '../../shared/request-routing';
import { Context as RequestContext } from '../../types/custom/context';
import { isAuthenticated, resolveRequestOrigin } from '../auth/auth-session';
import { RuntimeConfig } from '../config/runtime-config';
import {
  resolveAuthenticationContext,
  resolveExplicitTenantDomain,
  resolvePlatformAuthority,
  resolveRequestPermissions,
  resolveTenantContext,
  resolveUserContext,
} from './request-context-resolver';

export class HttpRequestTenantNotFoundError extends Schema.TaggedErrorClass<HttpRequestTenantNotFoundError>()(
  'HttpRequestTenantNotFoundError',
  {
    domain: Schema.String,
    message: Schema.String,
  },
) {}

const resolveRequestHeader = (
  request: HttpServerRequest.HttpServerRequest,
  name: string,
): string | undefined => {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  return;
};

export const resolveHttpRequestContext = (
  request: HttpServerRequest.HttpServerRequest,
  authSession: AuthSession | undefined,
  routing: {
    readonly trustedTenantDomain?: string | undefined;
  } = {},
): Effect.Effect<
  Schema.Schema.Type<typeof RequestContext>,
  EffectDrizzleQueryError | HttpRequestTenantNotFoundError,
  Database | RuntimeConfig
> =>
  Effect.gen(function* () {
    const { deployment, testRuntime } = yield* RuntimeConfig;
    const requestOrigin = resolveRequestOrigin(request);
    const authentication = resolveAuthenticationContext({
      isAuthenticated: isAuthenticated(authSession),
    });

    const { cause, tenant } = yield* resolveTenantContext({
      protocol: requestOrigin.protocol,
      requestHost: resolveRequestHeader(request, 'host'),
      routedTenantDomain: resolveExplicitTenantDomain({
        applicationEnvironment: deployment.APP_ENVIRONMENT,
        localTestTenantDomain:
          resolveRequestHeader(request, localTestTenantDomainHeader) ??
          Option.getOrUndefined(testRuntime.TENANT_DOMAIN),
        trustedTenantDomain: routing.trustedTenantDomain,
      }),
    });

    if (!tenant) {
      yield* Effect.logError('Tenant not found').pipe(
        Effect.annotateLogs({ cause }),
      );
      yield* new HttpRequestTenantNotFoundError({
        domain: cause.domain,
        message: 'Tenant not found',
      });
    }

    const resolvedTenant =
      tenant ??
      (yield* Effect.die(
        new Error('Tenant resolution did not terminate after not-found error'),
      ));

    const tenantUser = yield* resolveUserContext({
      isAuthenticated: isAuthenticated(authSession),
      oidcUser: authSession?.authData,
      tenantId: resolvedTenant.id,
    });
    const platformAuthority = resolvePlatformAuthority(authSession?.authData);
    const permissions = resolveRequestPermissions({
      platformAuthority,
      user: tenantUser,
    });

    return Schema.decodeUnknownSync(RequestContext)({
      authentication,
      permissions,
      platformAuthority,
      tenant: resolvedTenant,
      user: tenantUser,
    });
  });
