import { inject, REQUEST, REQUEST_CONTEXT, RESPONSE_INIT } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router } from '@angular/router';
import {
  forwardLoginPath,
  relativeRedirectPathFromRequest,
} from '@shared/auth-redirect';

import { type Context } from '../../../types/custom/context';
import { AppRpc } from '../effect-rpc-angular-client';

const ssrRedirectCompletionPath = '/404';

export const authGuard: CanActivateFn = async (_, state) => {
  const context = inject(REQUEST_CONTEXT) as Context | undefined;
  if (context) {
    if (context.authentication.isAuthenticated) {
      return true;
    }

    const response = inject(RESPONSE_INIT);
    const request = inject(REQUEST);
    if (response && request) {
      response.status = 303;
      const router = inject(Router);
      const forwardPath = router.parseUrl(
        forwardLoginPath(relativeRedirectPathFromRequest(request)),
      );

      // Angular SSR returns no response when a guard simply rejects its
      // initial navigation. Complete a safe internal navigation while keeping
      // the server login endpoint as the browser-facing redirect target.
      return new RedirectCommand(router.parseUrl(ssrRedirectCompletionPath), {
        browserUrl: forwardPath,
      });
    }
    return false;
  }

  const rpc = AppRpc.injectClient();
  const isAuthenticated = await rpc.config.isAuthenticated.call();
  if (!isAuthenticated) {
    globalThis.location.assign(forwardLoginPath(state.url));
    return false;
  }

  return true;
};
