import type * as HttpServerRequest from '@effect/platform/HttpServerRequest';

import { Effect, Schema } from 'effect';

import type { AuthSession } from '../auth/auth-session';

import { Context as RequestContext } from '../../types/custom/context';
import { isAuthenticated, resolveRequestOrigin } from '../auth/auth-session';
import {
  resolveAuthenticationContext,
  resolveTenantContext,
  resolveUserContext,
} from './request-context-resolver';

const resolveRequestHost = (
  request: HttpServerRequest.HttpServerRequest,
): readonly string[] | string | undefined =>
  request.headers['x-forwarded-host'] ?? request.headers['host'];

export const resolveHttpRequestContext = (
  request: HttpServerRequest.HttpServerRequest,
  authSession: AuthSession | undefined,
) =>
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
      signedCookies: undefined,
    });

    if (!tenant) {
      yield* Effect.logError('Tenant not found').pipe(
        Effect.annotateLogs({ cause }),
      );
      return yield* Effect.fail(new Error('Tenant not found', { cause }));
    }

    const user = yield* resolveUserContext({
      isAuthenticated: isAuthenticated(authSession),
      oidcUser: authSession?.authData,
      tenantId: tenant.id,
    });

    return Schema.decodeUnknownSync(RequestContext)({
      authentication,
      tenant,
      user,
    });
  });
