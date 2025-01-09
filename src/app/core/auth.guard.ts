import { inject, REQUEST, REQUEST_CONTEXT, RESPONSE_INIT } from '@angular/core';
import { CanActivateFn } from '@angular/router';

import { type Context } from '../../types/custom/context';
import { injectTrpcClient } from './trpc-client';

export const authGuard: CanActivateFn = async () => {
  const context = inject(REQUEST_CONTEXT) as Context | undefined;
  const trpcClient = injectTrpcClient();
  const response = inject(RESPONSE_INIT);
  const request = inject(REQUEST);
  if (!context) {
    const isAuthenticated = await trpcClient.config.isAuthenticated.query();
    if (!isAuthenticated) {
      globalThis.location.href = `/forward-login?redirectUrl=${globalThis.location.pathname}`;
      return false;
    }
  } else if (!context.authentication.isAuthenticated) {
    if (response && request) {
      response.status = 303;
      response.headers = {
        Location: `/forward-login?redirectUrl=${request.url}`,
      };
    }
    return false;
  }

  return true;
};
