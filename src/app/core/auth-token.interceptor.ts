import { isPlatformServer } from '@angular/common';
import { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';

import { type Context } from '../../types/custom/context';

export const authTokenInterceptor: HttpInterceptorFn = (request, next) => {
  const requestContext = inject(REQUEST_CONTEXT) as Context | null;
  const platformId = inject(PLATFORM_ID);

  if (isPlatformServer(platformId) && requestContext === null) {
    request = request.clone({
      setHeaders: {
        'x-no-context-on-server': 'true',
      },
    });
  }

  if (requestContext?.authentication?.cookie) {
    request = request.clone({
      setHeaders: {
        Cookie: `appSession=${requestContext.authentication.cookie}; evorto-tenant=${requestContext.tenant.domain}`,
      },
    });
  }
  return next(request);
};
