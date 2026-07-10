import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AppRpc } from '../effect-rpc-angular-client';

export const requiresTenantOnboarding = (input: {
  isAuthenticated: boolean;
  onboardingComplete: boolean;
}): boolean => input.isAuthenticated && !input.onboardingComplete;

export const userAccountGuard: CanActivateFn = async () => {
  const rpc = AppRpc.injectClient();
  const router = inject(Router);
  const isAuthenticated = await rpc.config.isAuthenticated.call();
  if (!isAuthenticated) {
    return true;
  }
  const onboardingStatus = await rpc.onboarding.status.call();
  if (
    requiresTenantOnboarding({
      isAuthenticated,
      onboardingComplete: onboardingStatus.complete,
    })
  ) {
    return router.createUrlTree(['/create-account']);
  }
  return true;
};
