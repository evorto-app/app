import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { injectTRPCClient } from '../trpc-client';

export const userAccountGuard: CanActivateFn = async () => {
  const trpcClient = injectTRPCClient();
  const router = inject(Router);
  const isAuthenticated = await trpcClient.config.isAuthenticated.query();
  if (!isAuthenticated) {
    return true;
  }
  const self = await trpcClient.users.userAssigned.query();
  if (!self) {
    return router.createUrlTree(['/create-account']);
  }
  return true;
};
