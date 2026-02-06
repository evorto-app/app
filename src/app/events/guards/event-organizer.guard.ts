import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { injectTRPCClient } from '../../core/trpc-client';

export const eventOrganizerGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const trpc = injectTRPCClient();
  const eventId = route.params['eventId'];

  try {
    // Verify the event exists
    await trpc.events.findOne.query({ id: eventId });
    const canOrganize = await trpc.events.canOrganize.query({ eventId });
    return canOrganize ? true : router.createUrlTree(['/403']);
  } catch {
    // Event not found or access denied
    return router.createUrlTree(['/404']);
  }
};
