import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { PermissionsService } from '../../core/permissions.service';
import { injectTRPCClient } from '../../core/trpc-client';

export const eventEditGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const trpc = injectTRPCClient();
  const permissions = inject(PermissionsService);
  const eventId = route.params['id'];

  if (!permissions.hasPermissionSync('events:edit')) {
    return router.createUrlTree(['/403']);
  }

  try {
    const event = await trpc.events.findOne.query({ id: eventId });
    if (event.status !== 'draft' && event.status !== 'rejected') {
      return router.createUrlTree(['/events', eventId], {
        queryParams: { error: 'event-locked' },
      });
    }
    return true;
  } catch {
    return router.createUrlTree(['/404']);
  }
};
