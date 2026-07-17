const validHost =
  /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(?::[0-9]{1,5})?$/iu;

const trustedForwardedProtocol = (headers: Headers) => {
  const value = headers.get('x-forwarded-proto')?.trim().toLowerCase();
  return value === 'http' || value === 'https' ? value : undefined;
};

export interface NodeRequestBoundary {
  readonly headers: Headers;
  readonly url: string;
}

export interface NodeRequestBoundaryInput {
  readonly headers: Headers;
  readonly requestTarget: string | undefined;
  readonly socketEncrypted: boolean;
  readonly trustPlatformProxy: boolean;
}

export const resolveNodeRequestBoundary = ({
  headers: sourceHeaders,
  requestTarget,
  socketEncrypted,
  trustPlatformProxy,
}: NodeRequestBoundaryInput): NodeRequestBoundary | undefined => {
  const headers = new Headers(sourceHeaders);
  const host = headers.get('host')?.trim();
  const target = requestTarget ?? '/';

  // Tenant selection always uses the real Host header. Remove forwarded host
  // variants at the Node boundary so later code cannot accidentally trust one.
  headers.delete('x-forwarded-host');
  headers.delete('forwarded');
  headers.delete('x-forwarded-protocol');

  const forwardedProtocol = trustPlatformProxy
    ? trustedForwardedProtocol(headers)
    : undefined;
  if (forwardedProtocol) {
    headers.set('x-forwarded-proto', forwardedProtocol);
  } else {
    headers.delete('x-forwarded-proto');
  }

  if (
    !host ||
    !validHost.test(host) ||
    !target.startsWith('/') ||
    target.startsWith('//')
  ) {
    return;
  }

  const protocol = forwardedProtocol ?? (socketEncrypted ? 'https' : 'http');
  try {
    const origin = new URL(`${protocol}://${host}`);
    if (origin.username || origin.password || origin.pathname !== '/') {
      return;
    }
    const url = new URL(target, origin);
    if (url.origin !== origin.origin) {
      return;
    }
    return { headers, url: url.toString() };
  } catch {
    return;
  }
};
