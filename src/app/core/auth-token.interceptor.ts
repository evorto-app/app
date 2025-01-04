import { HttpInterceptorFn } from '@angular/common/http';
import { inject, REQUEST_CONTEXT } from '@angular/core';

import { type Context } from '../../types/custom/context';

export const authTokenInterceptor: HttpInterceptorFn = (request, next) => {
  console.log('authTokenInterceptor');
  const requestContext = inject(REQUEST_CONTEXT) as Context | undefined;
  if (requestContext?.authentication?.cookie) {
    console.log('Adding access token to request');
    request = request.clone({
      setHeaders: {
        Cookie: `appSession=${requestContext.authentication.cookie}`,
      },
    });
  }
  return next(request);
};
