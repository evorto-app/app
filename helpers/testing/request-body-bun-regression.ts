import type { IncomingMessage, ServerResponse } from 'node:http';

import { Effect } from 'effect';
import { request as createHttpRequest, createServer } from 'node:http';

import {
  discardNodeRequestBody,
  readNodeRequestBody,
} from '../../src/server/http/request-body';

const decoder = new TextDecoder();
const unhandledRejections: unknown[] = [];
const uncaughtExceptions: unknown[] = [];
const onUnhandledRejection = (cause: unknown) => {
  unhandledRejections.push(cause);
};
const onUncaughtException = (cause: unknown) => {
  uncaughtExceptions.push(cause);
};
process.on('unhandledRejection', onUnhandledRejection);
process.on('uncaughtExceptionMonitor', onUncaughtException);

const abortResult = Promise.withResolvers<string>();
const abortRequestStarted = Promise.withResolvers<void>();
const oversizedResult = Promise.withResolvers<string>();

const handleRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  if (request.url === '/abort') {
    const resultPromise = Effect.runPromise(
      readNodeRequestBody(request, 10).pipe(
        Effect.match({
          onFailure: (error) => error._tag,
          onSuccess: () => 'unexpected-success',
        }),
      ),
    );
    abortRequestStarted.resolve();
    const result = await resultPromise;
    abortResult.resolve(result);
    response.end();
    return;
  }

  if (request.url === '/oversized') {
    const result = await Effect.runPromise(
      readNodeRequestBody(request, 4).pipe(
        Effect.match({
          onFailure: (error) => error._tag,
          onSuccess: () => 'unexpected-success',
        }),
      ),
    );
    oversizedResult.resolve(result);
    response.statusCode = result === 'RequestBodyTooLargeError' ? 413 : 500;
    response.end();
    return;
  }

  if (request.url === '/exact') {
    const result = await Effect.runPromise(
      readNodeRequestBody(request, 4).pipe(
        Effect.match({
          onFailure: (error) => ({ error: error._tag }),
          onSuccess: (body) => ({ body: decoder.decode(body) }),
        }),
      ),
    );
    if ('error' in result) {
      response.statusCode = 500;
      response.end(result.error);
      return;
    }
    response.end(result.body);
    return;
  }

  if (request.url === '/unsupported') {
    discardNodeRequestBody(request);
    response.statusCode = 404;
    response.end();
    return;
  }

  response.statusCode = 404;
  response.end();
};

const serverFailure = Promise.withResolvers<never>();
const server = createServer((request, response) => {
  void handleRequest(request, response).catch(serverFailure.reject);
});

const withTimeout = async <A>(promise: Promise<A>, label: string) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          5000,
        );
      }),
      serverFailure.promise,
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

const responseBody = (
  port: number,
  path: string,
  body: string,
  headers: Record<string, string>,
) =>
  new Promise<{ readonly body: string; readonly status: number }>(
    (resolve, reject) => {
      const request = createHttpRequest({
        agent: false,
        headers,
        host: '127.0.0.1',
        method: 'POST',
        path,
        port,
      });
      request.once('error', reject);
      request.once('response', (response) => {
        const chunks: Uint8Array[] = [];
        response.on('data', (chunk: Uint8Array) => {
          chunks.push(chunk);
        });
        response.once('end', () => {
          resolve({
            body: decoder.decode(Buffer.concat(chunks)),
            status: response.statusCode ?? 0,
          });
        });
      });
      request.end(body);
    },
  );

try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Bun regression server did not expose a TCP port');
  }

  const abortedClient = createHttpRequest({
    agent: false,
    headers: { 'content-length': '10' },
    host: '127.0.0.1',
    method: 'POST',
    path: '/abort',
    port: address.port,
  });
  abortedClient.once('error', () => null);
  abortedClient.write('abc');
  await withTimeout(abortRequestStarted.promise, 'aborted request start');
  abortedClient.destroy();
  const aborted = await withTimeout(abortResult.promise, 'aborted request');

  const oversizedClient = createHttpRequest({
    agent: false,
    headers: { 'transfer-encoding': 'chunked' },
    host: '127.0.0.1',
    method: 'POST',
    path: '/oversized',
    port: address.port,
  });
  const oversizedResponse = new Promise<number>((resolve, reject) => {
    oversizedClient.once('error', reject);
    oversizedClient.once('response', (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
  });
  oversizedClient.write('abcd');
  oversizedClient.write('e');
  const oversizedStatus = await withTimeout(
    oversizedResponse,
    'oversized response before request end',
  );
  oversizedClient.destroy();
  const oversized = await withTimeout(
    oversizedResult.promise,
    'oversized request result',
  );

  const exact = await withTimeout(
    responseBody(address.port, '/exact', 'abcd', {
      'content-length': '4',
    }),
    'exact-limit request',
  );
  const unsupportedClient = createHttpRequest({
    agent: false,
    headers: { 'transfer-encoding': 'chunked' },
    host: '127.0.0.1',
    method: 'POST',
    path: '/unsupported',
    port: address.port,
  });
  const unsupportedResponse = new Promise<number>((resolve, reject) => {
    unsupportedClient.once('error', reject);
    unsupportedClient.once('response', (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
  });
  unsupportedClient.write('held-open');
  const unsupportedStatus = await withTimeout(
    unsupportedResponse,
    'unsupported response before request end',
  );
  unsupportedClient.destroy();
  await Bun.sleep(100);

  process.stdout.write(
    JSON.stringify({
      aborted,
      exact,
      oversized,
      oversizedStatus,
      unsupportedStatus,
      uncaughtExceptions: uncaughtExceptions.length,
      unhandledRejections: unhandledRejections.length,
    }),
  );
} finally {
  process.off('unhandledRejection', onUnhandledRejection);
  process.off('uncaughtExceptionMonitor', onUncaughtException);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
