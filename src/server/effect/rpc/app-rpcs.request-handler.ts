import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import { Effect } from 'effect';

import { type Context as RequestContext } from '../../../types/custom/context';
import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from './rpc-context-headers';

const buildRpcUser = (context: RequestContext) => {
  if (!context.user) {
    return;
  }

  return {
    attributes: context.user.attributes,
    auth0Id: context.user.auth0Id,
    email: context.user.email,
    firstName: context.user.firstName,
    iban: context.user.iban,
    id: context.user.id,
    lastName: context.user.lastName,
    paypalEmail: context.user.paypalEmail,
    permissions: context.user.permissions,
    roleIds: context.user.roleIds,
  };
};

export const toRpcHttpServerRequest = (
  request: Request,
  context: RequestContext,
  authData: Record<string, unknown>,
) =>
  Effect.gen(function* () {
  const headers = new Headers(request.headers);
  const user = buildRpcUser(context);

  headers.set(
    RPC_CONTEXT_HEADERS.AUTHENTICATED,
    context.authentication.isAuthenticated ? 'true' : 'false',
  );
  headers.set(
    RPC_CONTEXT_HEADERS.PERMISSIONS,
    encodeRpcContextHeaderJson(user?.permissions ?? []),
  );
  headers.set(
    RPC_CONTEXT_HEADERS.USER,
    encodeRpcContextHeaderJson(user ?? null),
  );
  headers.set(RPC_CONTEXT_HEADERS.USER_ASSIGNED, user ? 'true' : 'false');
  headers.set(
    RPC_CONTEXT_HEADERS.AUTH_DATA,
    encodeRpcContextHeaderJson(authData),
  );
  headers.set(
    RPC_CONTEXT_HEADERS.TENANT,
    encodeRpcContextHeaderJson(context.tenant),
  );

  if (request.method === 'GET' || request.method === 'HEAD') {
    return HttpServerRequest.fromWeb(
      new Request(request.url, {
        headers,
        method: request.method,
      }),
    );
  }

  const body = yield* Effect.tryPromise(() => request.arrayBuffer());
  return HttpServerRequest.fromWeb(
    new Request(request.url, {
      body,
      headers,
      method: request.method,
    }),
  );
});
