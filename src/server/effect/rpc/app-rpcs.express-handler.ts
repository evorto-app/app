import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

import { writeWebResponse } from '../../http/write-web-response';
import { handleAppRpcWebRequest } from './app-rpcs.web-handler';
import { RPC_CONTEXT_HEADERS } from './rpc-context-headers';

const methodWithoutBody = new Set(['GET', 'HEAD']);

const getRequestBody = async (
  request: ExpressRequest,
): Promise<Buffer | undefined> => {
  if (methodWithoutBody.has(request.method)) {
    return undefined;
  }

  return new Promise<Buffer | undefined>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => {
      resolve(chunks.length > 0 ? Buffer.concat(chunks) : undefined);
    });
    request.on('error', reject);
  });
};

const toWebRequest = async (request: ExpressRequest): Promise<Request> => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const headerValue of value) {
        headers.append(key, headerValue);
      }
      continue;
    }

    headers.set(key, value);
  }

  const body = await getRequestBody(request);
  const host = request.get('host') ?? 'localhost';
  const url = `${request.protocol}://${host}${request.originalUrl}`;
  const rpcUser = request.user
    ? {
        attributes: request.user.attributes,
        auth0Id: request.user.auth0Id,
        email: request.user.email,
        firstName: request.user.firstName,
        // eslint-disable-next-line unicorn/no-null
        iban: request.user.iban ?? null,
        id: request.user.id,
        lastName: request.user.lastName,
        // eslint-disable-next-line unicorn/no-null
        paypalEmail: request.user.paypalEmail ?? null,
        permissions: request.user.permissions,
        roleIds: request.user.roleIds,
      }
    : null;
  const authData =
    request.oidc?.user && typeof request.oidc.user === 'object'
      ? request.oidc.user
      : null;

  // Bridge Express middleware context into RPC headers for typed handler decoding.
  headers.set(
    RPC_CONTEXT_HEADERS.AUTHENTICATED,
    request.authentication?.isAuthenticated ? 'true' : 'false',
  );
  headers.set(
    RPC_CONTEXT_HEADERS.PERMISSIONS,
    JSON.stringify(request.user?.permissions ?? []),
  );
  headers.set(RPC_CONTEXT_HEADERS.USER, JSON.stringify(rpcUser));
  headers.set(
    RPC_CONTEXT_HEADERS.USER_ASSIGNED,
    request.user ? 'true' : 'false',
  );
  headers.set(RPC_CONTEXT_HEADERS.AUTH_DATA, JSON.stringify(authData ?? {}));
  headers.set(RPC_CONTEXT_HEADERS.TENANT, JSON.stringify(request.tenant));

  const requestInit: RequestInit = {
    headers,
    method: request.method,
  };

  if (body !== undefined) {
    requestInit.body = new Uint8Array(body);
  }

  return new Request(url, requestInit);
};

export const handleAppRpcRequest = async (
  request: ExpressRequest,
  response: ExpressResponse,
) => {
  const webRequest = await toWebRequest(request);
  const webResponse = await handleAppRpcWebRequest(webRequest);
  await writeWebResponse(response, webResponse);
};
