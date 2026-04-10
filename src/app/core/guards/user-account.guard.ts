import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AppRpc } from '../effect-rpc-angular-client';

export const userAccountGuard: CanActivateFn = async () => {
  const rpc = AppRpc.injectClient();
  const router = inject(Router);
  const isAuthenticated = await rpc.config.isAuthenticated.call();
  if (!isAuthenticated) {
    return true;
  }
  const userAssigned = await rpc.users.userAssigned.call();
  if (!userAssigned) {
    return router.createUrlTree(['/create-account']);
  }
  return true;
};
