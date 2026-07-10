import { Effect } from 'effect';
import * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest';

import { type Context as RequestContext } from '../../../types/custom/context';
import { readRequestBody } from '../../http/request-body';
import {
  encodeRpcContextHeaderJson,
  RPC_CONTEXT_HEADERS,
} from './rpc-context-headers';

// The largest RPC upload is a 20 MiB receipt encoded as base64. This leaves
// room for that encoding and the RPC envelope while bounding the whole batch.
export const MAX_RPC_BODY_SIZE_BYTES = 32 * 1024 * 1024;

const buildRpcUser = (context: RequestContext) => {
  if (!context.user) {
    return;
  }

  return {
    attributes: context.user.attributes,
    auth0Id: context.user.auth0Id,
    communicationEmail: context.user.communicationEmail,
    email: context.user.email,
    firstName: context.user.firstName,
    homeTenantId: context.user.homeTenantId,
    homeTenantName: context.user.homeTenantName,
    iban: context.user.iban,
    id: context.user.id,
    lastName: context.user.lastName,
    paypalEmail: context.user.paypalEmail,
    permissions: context.user.permissions,
    roleIds: context.user.roleIds,
  };
};

const withRpcContextHeaders = (
  request: Request,
  context: RequestContext,
  authData: Record<string, unknown>,
): Headers => {
  const headers = new Headers(request.headers);
  const user = buildRpcUser(context);

  headers.set(
    RPC_CONTEXT_HEADERS.AUTHENTICATED,
    context.authentication.isAuthenticated ? 'true' : 'false',
  );
  headers.set(
    RPC_CONTEXT_HEADERS.PERMISSIONS,
    encodeRpcContextHeaderJson(context.permissions),
  );
  headers.set(
    RPC_CONTEXT_HEADERS.PLATFORM_AUTHORITY,
    encodeRpcContextHeaderJson(context.platformAuthority ?? null),
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

  return headers;
};

const toRequestWithHeaders = (
  request: Request,
  headers: Headers,
  body?: BodyInit,
): Request => {
  const init: RequestInit = {
    headers,
    method: request.method,
  };

  if (body === undefined) {
    return new Request(request.url, init);
  }

  return new Request(request.url, { ...init, body });
};

export const toRpcHttpServerRequest = (
  request: Request,
  context: RequestContext,
  authData: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    // RPC handlers consume request-context only from headers, so we bridge
    // framework context values into deterministic RPC headers here.
    const headers = withRpcContextHeaders(request, context, authData);
    if (request.method === 'GET' || request.method === 'HEAD') {
      return HttpServerRequest.fromWeb(toRequestWithHeaders(request, headers));
    }

    // Non-GET requests can only be read once; buffer within the route limit
    // before cloning the request with its trusted context headers.
    const body = yield* readRequestBody(request, MAX_RPC_BODY_SIZE_BYTES);
    return HttpServerRequest.fromWeb(
      toRequestWithHeaders(request, headers, body),
    );
  });
