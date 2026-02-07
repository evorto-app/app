import { inject, REQUEST, REQUEST_CONTEXT, RESPONSE_INIT } from '@angular/core';
import { CanActivateFn } from '@angular/router';

import { type Context } from '../../../types/custom/context';
import { EffectRpcClient } from '../effect-rpc-client';

export const authGuard: CanActivateFn = async (_, state) => {
  const context = inject(REQUEST_CONTEXT) as Context | undefined;
  const rpcClient = inject(EffectRpcClient);
  const response = inject(RESPONSE_INIT);
  const request = inject(REQUEST);
  if (!context) {
    const isAuthenticated = await rpcClient.isAuthenticated();
    if (!isAuthenticated) {
      globalThis.location.href = `/forward-login?redirectUrl=${state.url}`;
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
