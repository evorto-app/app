import { isPlatformServer } from '@angular/common';
import { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID, REQUEST, REQUEST_CONTEXT } from '@angular/core';

import { type Context } from '../../types/custom/context';
import { resolveServerRpcOrigin } from './effect-rpc-angular-client';

const isInternalServerRpcRequest = (
  outgoingUrl: string,
  incomingRequest: Request,
): boolean => {
  try {
    const trustedOrigin = resolveServerRpcOrigin(incomingRequest);
    const outgoing = new URL(outgoingUrl);

    return (
      outgoing.origin === trustedOrigin &&
      (outgoing.pathname === '/rpc' || outgoing.pathname === '/rpc/') &&
      outgoing.search === '' &&
      outgoing.hash === ''
    );
  } catch {
    return false;
  }
};

export const authTokenInterceptor: HttpInterceptorFn = (request, next) => {
  const requestContext = inject(REQUEST_CONTEXT) as Context | null;
  const platformId = inject(PLATFORM_ID);

  if (isPlatformServer(platformId)) {
    if (requestContext === null) {
      request = request.clone({
        setHeaders: {
          'x-no-context-on-server': 'true',
        },
      });
    } else {
      const incomingRequest = inject(REQUEST, { optional: true });
      const cookieHeader = incomingRequest?.headers.get('cookie');

      // Auth0 sessions can span multiple encrypted, chunked cookies. Forward
      // the original server-only header only to this app's internal RPC URL;
      // never reconstruct it from request context or expose it to the browser.
      if (
        incomingRequest &&
        cookieHeader &&
        isInternalServerRpcRequest(request.url, incomingRequest)
      ) {
        request = request.clone({
          setHeaders: {
            Cookie: cookieHeader,
            'x-forwarded-from': 'ssr',
            'x-tenant-id': requestContext.tenant.id,
          },
        });
      }
    }
  }

  return next(request);
};
