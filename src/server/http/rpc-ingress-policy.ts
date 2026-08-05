const jsonContentType = 'application/json';
const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;

export interface RpcIngressPolicyOptions {
  readonly applicationOrigin?: string | undefined;
  readonly ssrRpcOrigin?: string | undefined;
}

export type RpcIngressPolicyResult<A> =
  | {
      readonly accepted: false;
      readonly response: Response;
    }
  | {
      readonly accepted: true;
      readonly value: A;
    };

const reject = (status: 403 | 415): RpcIngressPolicyResult<never> => ({
  accepted: false,
  response: new Response(null, { headers: noStoreHeaders, status }),
});

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  hostname === '[::1]';

const resolveInternalSsrOrigin = (
  configuredOrigin: string | undefined,
): string | undefined => {
  if (!configuredOrigin) {
    return;
  }

  try {
    const url = new URL(configuredOrigin.trim());
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !isLoopbackHostname(url.hostname) ||
      url.username !== '' ||
      url.password !== '' ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return;
    }

    return url.origin;
  } catch {
    return;
  }
};

const isTrustedInternalSsrRequest = (
  request: Request,
  applicationOrigin: string | undefined,
  configuredOrigin: string | undefined,
): boolean => {
  const internalSsrOrigin = resolveInternalSsrOrigin(configuredOrigin);
  if (!internalSsrOrigin) {
    return false;
  }

  try {
    return (
      applicationOrigin === internalSsrOrigin &&
      new URL(request.url).origin === internalSsrOrigin &&
      request.headers.get('x-forwarded-from') === 'ssr' &&
      (request.headers.get('x-tenant-id')?.trim().length ?? 0) > 0
    );
  } catch {
    return false;
  }
};

const hasExactJsonContentType = (request: Request): boolean =>
  request.headers.get('content-type')?.trim().toLowerCase() === jsonContentType;

const hasCookie = (request: Request): boolean => request.headers.has('cookie');

const resolveApplicationOrigin = (
  request: Request,
  configuredOrigin: string | undefined,
): string | undefined => {
  try {
    const origin = configuredOrigin ?? new URL(request.url).origin;
    const url = new URL(origin);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.origin !== origin
    ) {
      return;
    }

    return origin;
  } catch {
    return;
  }
};

/**
 * Applies the RPC request boundary before constructing or running the handler.
 *
 * Browser requests with cookies require an exact same-origin `Origin` header.
 * Angular SSR is the sole no-Origin cookie caller and is accepted only on the
 * configured loopback RPC origin with the headers its interceptor supplies.
 */
export const runRpcIngressPolicy = <A>(
  request: Request,
  handle: () => A,
  options?: RpcIngressPolicyOptions,
): RpcIngressPolicyResult<A> => {
  if (!hasExactJsonContentType(request)) {
    return reject(415);
  }

  const applicationOrigin = resolveApplicationOrigin(
    request,
    options?.applicationOrigin,
  );
  const origin = request.headers.get('origin');
  if (origin !== null) {
    if (origin !== applicationOrigin) {
      return reject(403);
    }
  } else if (
    hasCookie(request) &&
    !isTrustedInternalSsrRequest(
      request,
      applicationOrigin,
      options?.ssrRpcOrigin ?? process.env['SSR_RPC_ORIGIN'],
    )
  ) {
    return reject(403);
  }

  return { accepted: true, value: handle() };
};
