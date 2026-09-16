import {
  trustedSsrSourceHeader,
  trustedSsrSourceValue,
  trustedTenantDomainHeader,
} from '../../shared/request-routing';

const jsonContentType = 'application/json';
const noStoreHeaders = { 'Cache-Control': 'no-store' } as const;

export interface RpcIngressContext {
  readonly trustedTenantDomain: string | undefined;
}

export interface RpcIngressPolicyOptions {
  readonly applicationOrigin: string;
  readonly ssrRpcCapability: string;
  readonly ssrRpcOrigin: string | undefined;
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

  const origin = configuredOrigin.trim();
  if (!/^https?:\/\/[^/\\\s@?#]+\/?$/iu.test(origin)) {
    return;
  }

  try {
    const url = new URL(origin);
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
  capability: string,
): boolean => {
  const internalSsrOrigin = resolveInternalSsrOrigin(configuredOrigin);
  if (!internalSsrOrigin || !capability) {
    return false;
  }

  try {
    return (
      request.headers.get('authorization') === `Bearer ${capability}` &&
      applicationOrigin === internalSsrOrigin &&
      new URL(request.url).origin === internalSsrOrigin &&
      request.headers.get(trustedSsrSourceHeader) === trustedSsrSourceValue &&
      (request.headers.get(trustedTenantDomainHeader)?.trim().length ?? 0) > 0
    );
  } catch {
    return false;
  }
};

const hasExactJsonContentType = (request: Request): boolean =>
  request.headers.get('content-type')?.trim().toLowerCase() === jsonContentType;

const hasCookie = (request: Request): boolean => request.headers.has('cookie');

const resolveApplicationOrigin = (
  configuredOrigin: string,
): string | undefined => {
  try {
    const url = new URL(configuredOrigin);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.origin !== configuredOrigin
    ) {
      return;
    }

    return configuredOrigin;
  } catch {
    return;
  }
};

export const runRpcIngressPolicy = <A>(
  request: Request,
  handle: (context: RpcIngressContext) => A,
  options: RpcIngressPolicyOptions,
): RpcIngressPolicyResult<A> => {
  if (!hasExactJsonContentType(request)) {
    return reject(415);
  }

  const applicationOrigin = resolveApplicationOrigin(options.applicationOrigin);
  const origin = request.headers.get('origin');
  const trustedInternalSsrRequest =
    origin === null &&
    isTrustedInternalSsrRequest(
      request,
      applicationOrigin,
      options.ssrRpcOrigin,
      options.ssrRpcCapability,
    );
  if (origin !== null) {
    if (origin !== applicationOrigin) {
      return reject(403);
    }
  } else if (hasCookie(request) && !trustedInternalSsrRequest) {
    return reject(403);
  }

  return {
    accepted: true,
    value: handle({
      trustedTenantDomain: trustedInternalSsrRequest
        ? (request.headers.get(trustedTenantDomainHeader) ?? undefined)
        : undefined,
    }),
  };
};
