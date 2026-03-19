import type * as HttpServerRequest from '@effect/platform/HttpServerRequest';

import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { Effect, Schema } from 'effect';

import type { AuthSession } from '../auth/auth-session';

import { Database } from '../../db';
import { Context as RequestContext } from '../../types/custom/context';
import { isAuthenticated, resolveRequestOrigin } from '../auth/auth-session';
import {
  resolveAuthenticationContext,
  resolveTenantContext,
  resolveUserContext,
} from './request-context-resolver';

export class HttpRequestTenantNotFoundError extends Schema.TaggedError<HttpRequestTenantNotFoundError>()(
  'HttpRequestTenantNotFoundError',
  {
    domain: Schema.String,
    message: Schema.String,
    tenantCookie: Schema.String,
  },
) {}

const resolveRequestHost = (
  request: HttpServerRequest.HttpServerRequest,
): readonly string[] | string | undefined =>
  request.headers['x-forwarded-host'] ?? request.headers['host'];

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
      appSessionCookie: request.cookies['appSession'],
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
      (yield* Effect.dieMessage(
        'Tenant resolution did not terminate after not-found error',
      ));

    const user = yield* resolveUserContext({
      isAuthenticated: isAuthenticated(authSession),
      oidcUser: authSession?.authData,
      tenantId: resolvedTenant.id,
    });

    return Schema.decodeUnknownSync(RequestContext)({
      authentication,
      tenant: resolvedTenant,
      user,
    });
  });
