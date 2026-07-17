import type * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest';

import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Effect, Schema } from 'effect';

import type { AuthSession } from '../auth/auth-session';

import { Database } from '../../db';
import { Context as RequestContext } from '../../types/custom/context';
import { isAuthenticated, resolveRequestOrigin } from '../auth/auth-session';
import {
  resolveAuthenticationContext,
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
    tenantCookie: Schema.String,
  },
) {}

const resolveRequestHost = (
  request: HttpServerRequest.HttpServerRequest,
): readonly string[] | string | undefined => request.headers['host'];

export const resolveHttpRequestContext = (
  request: HttpServerRequest.HttpServerRequest,
  authSession: AuthSession | undefined,
): Effect.Effect<
  Schema.Schema.Type<typeof RequestContext>,
  EffectDrizzleQueryError | HttpRequestTenantNotFoundError,
  Database
> =>
  Effect.gen(function* () {
    const requestOrigin = resolveRequestOrigin(request);
    const authentication = resolveAuthenticationContext({
      isAuthenticated: isAuthenticated(authSession),
    });

    const { cause, tenant } = yield* resolveTenantContext({
      cookies: request.cookies,
      protocol: requestOrigin.protocol,
      requestHost: resolveRequestHost(request),
    });

    if (!tenant) {
      yield* Effect.logError('Tenant not found').pipe(
        Effect.annotateLogs({ cause }),
      );
      yield* new HttpRequestTenantNotFoundError({
        domain: cause.domain,
        message: 'Tenant not found',
        tenantCookie: cause.tenantCookie,
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
      oidcUser: authSession?.authData,
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
