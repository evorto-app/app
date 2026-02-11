import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AppRpc } from '../effect-rpc-angular-client';
import { injectTRPCClient } from '../trpc-client';

export const userAccountGuard: CanActivateFn = async () => {
  const rpc = AppRpc.injectClient();
  const trpcClient = injectTRPCClient();
  const router = inject(Router);
  const isAuthenticated = await rpc.config.isAuthenticated.call();
  if (!isAuthenticated) {
    return true;
  }
  const self = await trpcClient.users.userAssigned.query();
  if (!self) {
    return router.createUrlTree(['/create-account']);
  }
  return true;
};
