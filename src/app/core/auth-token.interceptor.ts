import { isPlatformServer } from '@angular/common';
import { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID, REQUEST, REQUEST_CONTEXT } from '@angular/core';

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
      (outgoing.pathname === '/rpc' || outgoing.pathname === '/rpc/') &&
      outgoing.search === '' &&
      outgoing.hash === ''
    );
  } catch {
    return false;
  }
};

const tenantCookieName = 'evorto-tenant';

const withTrustedTenantCookie = (
  cookieHeader: null | string | undefined,
  trustedTenantDomain: string,
): string => {
  const cookies = cookieHeader
    ? cookieHeader
        .split(';')
        .map((cookie) => cookie.trim())
        .filter((cookie) => {
          if (!cookie) {
            return false;
          }

          const equalsIndex = cookie.indexOf('=');
          const cookieName =
            equalsIndex === -1 ? cookie : cookie.slice(0, equalsIndex).trim();
          return cookieName !== tenantCookieName;
        })
    : [];

  return [...cookies, `${tenantCookieName}=${trustedTenantDomain}`].join('; ');
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

      // Auth0 sessions can span multiple encrypted, chunked cookies. Preserve
      // those chunks when present, and always attach the trusted request-context
      // tenant to this app's exact internal RPC URL for anonymous SSR requests.
      if (incomingRequest && isInternalServerRpcRequest(request.url)) {
        request = request.clone({
          setHeaders: {
            Cookie: withTrustedTenantCookie(
              cookieHeader,
              requestContext.tenant.domain,
            ),
            'x-forwarded-from': 'ssr',
            'x-tenant-id': requestContext.tenant.id,
          },
        });
      }
    }
  }

  return next(request);
};
