import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';

export const eventOrganizerGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const queryClient = inject(QueryClient);
  const trpc = injectTRPC();
  const eventId = route.params['eventId'];

  try {
    // Verify the event exists
    await queryClient.fetchQuery(trpc.events.findOne.queryOptions({ id: eventId }));
    const canOrganize = await queryClient.fetchQuery(
      trpc.events.canOrganize.queryOptions({ eventId }),
    );
    return canOrganize ? true : router.createUrlTree(['/403']);
  } catch {
    // Event not found or access denied
    return router.createUrlTree(['/404']);
  }
};
