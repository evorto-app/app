import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';

export const eventOrganizerGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const queryClient = inject(QueryClient);
  const rpc = AppRpc.injectClient();
  const eventId = route.params['eventId'];

  try {
    // Verify the event exists
    await queryClient.fetchQuery(
      rpc.events.findOne.queryOptions({ id: eventId }),
    );
    const canOrganize = await queryClient.fetchQuery(
      rpc.events.canOrganize.queryOptions({ eventId }),
    );
    return canOrganize ? true : router.createUrlTree(['/403']);
  } catch {
    // Event not found or access denied
    return router.createUrlTree(['/404']);
  }
};
