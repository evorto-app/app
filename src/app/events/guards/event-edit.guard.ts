import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { eventRouteErrorPath } from '../event-rpc-error';

export const eventEditGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const queryClient = inject(QueryClient);
  const rpc = AppRpc.injectClient();
  const eventId = route.paramMap.get('eventId');

  if (!eventId) {
    return router.createUrlTree(['/404']);
  }

  try {
    await queryClient.fetchQuery(
      rpc.events.findGraphForEdit.queryOptions({ id: eventId }),
    );
    return true;
  } catch (error) {
    const tag =
      error && typeof error === 'object' && '_tag' in error
        ? error._tag
        : undefined;
    if (tag === 'EventConflictError') {
      return router.createUrlTree(['/events', eventId], {
        queryParams: { error: 'event-locked' },
      });
    }
    return router.createUrlTree([eventRouteErrorPath(error)]);
  }
};
