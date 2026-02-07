import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

import * as HttpServer from '@effect/platform/HttpServer';
import * as RpcSerialization from '@effect/rpc/RpcSerialization';
import * as RpcServer from '@effect/rpc/RpcServer';
import { Layer } from 'effect';

import { AppRpcs } from '../../../shared/rpc-contracts/app-rpcs';
import { appRpcHandlers } from './app-rpcs.handlers';

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

  // Bridge Express middleware context into RPC headers for typed handler decoding.
  headers.set(
    'x-evorto-authenticated',
    request.authentication?.isAuthenticated ? 'true' : 'false',
  );
  headers.set(
    'x-evorto-permissions',
    JSON.stringify(request.user?.permissions ?? []),
  );

  const requestInit: RequestInit = {
    headers,
    method: request.method,
  };

  if (body !== undefined) {
    requestInit.body = new Uint8Array(body);
  }

  return new Request(url, requestInit);
};

const writeWebResponse = async (
  response: ExpressResponse,
  webResponse: globalThis.Response,
) => {
  response.status(webResponse.status);
  for (const [key, value] of webResponse.headers.entries()) {
    response.setHeader(key, value);
  }

  const body = Buffer.from(await webResponse.arrayBuffer());
  response.send(body);
};

const appRpcLayer = Layer.mergeAll(
  appRpcHandlers,
  RpcSerialization.layerJson,
  HttpServer.layerContext,
);
const { handler: rpcWebHandler } = RpcServer.toWebHandler(AppRpcs, {
  layer: appRpcLayer,
});

export const handleAppRpcRequest = async (
  request: ExpressRequest,
  response: ExpressResponse,
) => {
  const webRequest = await toWebRequest(request);
  const webResponse = await rpcWebHandler(webRequest);
  await writeWebResponse(response, webResponse);
};
