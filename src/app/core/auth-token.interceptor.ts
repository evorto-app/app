import { isPlatformServer } from '@angular/common';
import { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID, REQUEST, REQUEST_CONTEXT } from '@angular/core';

import {
  readSsrRpcCapability,
  trustedSsrSourceHeader,
  trustedSsrSourceValue,
  trustedTenantDomainHeader,
} from '../../shared/request-routing';
import { type Context } from '../../types/custom/context';
import { resolveTrustedServerRpcOrigin } from './effect-rpc-angular-client';

const isInternalServerRpcRequest = (outgoingUrl: string): boolean => {
  try {
    const trustedOrigin = resolveTrustedServerRpcOrigin();
    if (!trustedOrigin) {
      return false;
    }

    const outgoing = new URL(outgoingUrl);

    return (
      outgoing.origin === trustedOrigin &&
      outgoing.username === '' &&
      outgoing.password === '' &&
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
      const capability = readSsrRpcCapability(requestContext);

      // Auth0 sessions can span multiple encrypted, chunked cookies. Preserve
      // those chunks when present and pass the already resolved tenant through
      // the separately gated internal SSR route.
      if (
        incomingRequest &&
        capability &&
        request.method === 'POST' &&
        isInternalServerRpcRequest(request.url)
      ) {
        request = request.clone({
          setHeaders: {
            Authorization: `Bearer ${capability}`,
            ...(cookieHeader && { Cookie: cookieHeader }),
            [trustedSsrSourceHeader]: trustedSsrSourceValue,
            [trustedTenantDomainHeader]: requestContext.tenant.domain,
          },
        });
      }
    }
  }

  return next(request);
};
