import { inject, REQUEST_CONTEXT } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { type Context } from '../../types/custom/context';
import { injectTrpcClient } from './trpc-client';

export const authGuard: CanActivateFn = async (route) => {
  console.log('authGuard');
  const context = inject(REQUEST_CONTEXT) as Context | undefined;
  const trpcClient = injectTrpcClient();
  const router = inject(Router);
  if (!context) {
    console.error('No context found in authGuard');
    const isAuthenticated = await trpcClient.config.isAuthenticated.query();
    console.log('isAuthenticated', isAuthenticated);
    if (!isAuthenticated) {
      globalThis.location.href = `/forward-login?redirectUrl=${globalThis.location.pathname}`;
    }
  } else if (!context.authentication.isAuthenticated) {
    router.createUrlTree(['/forward-login'], {
      queryParams: { redirectUrl: route.pathFromRoot },
    });
  }

  return true;
};
