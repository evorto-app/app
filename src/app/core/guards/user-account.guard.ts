import { inject, REQUEST_CONTEXT } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Context } from '../../../types/custom/context';
import { AppRpc } from '../effect-rpc-angular-client';

interface OnboardingGuardState {
  isAuthenticated: boolean;
  onboardingComplete: boolean;
}

export const requiresTenantOnboarding = (
  input: OnboardingGuardState,
): boolean => input.isAuthenticated && !input.onboardingComplete;

export const resolveOnboardingGuardState = (
  requestContext: Context | null,
  loadBrowserState: () => Promise<OnboardingGuardState>,
): OnboardingGuardState | Promise<OnboardingGuardState> =>
  requestContext
    ? {
        isAuthenticated: requestContext.authentication.isAuthenticated,
        onboardingComplete: requestContext.user !== undefined,
      }
    : loadBrowserState();

export const userAccountGuard: CanActivateFn = async () => {
  const requestContext = inject(REQUEST_CONTEXT, {
    optional: true,
  }) as Context | null;
  const router = inject(Router);
  const rpc = requestContext ? undefined : AppRpc.injectClient();
  const state = await resolveOnboardingGuardState(requestContext, async () => {
    if (!rpc) {
      throw new Error('Browser onboarding guard is missing its RPC client');
    }
    const isAuthenticated = await rpc.config.isAuthenticated.call();
    if (!isAuthenticated) {
      return { isAuthenticated, onboardingComplete: false };
    }
    const onboardingStatus = await rpc.onboarding.status.call();
    return {
      isAuthenticated,
      onboardingComplete: onboardingStatus.complete,
    };
  });
  if (requiresTenantOnboarding(state)) {
    return router.createUrlTree(['/create-account']);
  }
  return true;
};
