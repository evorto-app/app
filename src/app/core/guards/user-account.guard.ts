import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { EffectRpcClient } from '../effect-rpc-client';
import { injectTRPCClient } from '../trpc-client';

export const userAccountGuard: CanActivateFn = async () => {
  const rpcClient = inject(EffectRpcClient);
  const trpcClient = injectTRPCClient();
  const router = inject(Router);
  const isAuthenticated = await rpcClient.isAuthenticated();
  if (!isAuthenticated) {
    return true;
  }
  const self = await trpcClient.users.userAssigned.query();
  if (!self) {
    return router.createUrlTree(['/create-account']);
  }
  return true;
};
