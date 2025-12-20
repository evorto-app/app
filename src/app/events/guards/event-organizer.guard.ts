import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { PermissionsService } from '../../core/permissions.service';
import { injectTRPCClient } from '../../core/trpc-client';

export const eventOrganizerGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const trpc = injectTRPCClient();
  const permissions = inject(PermissionsService);
  const eventId = route.params['eventId'];

  // Check if user has general organize permission
  if (!permissions.hasPermissionSync('events:organizeAll')) {
    return router.createUrlTree(['/403']);
  }

  try {
    // Verify the event exists
    await trpc.events.findOne.query({ id: eventId });
    return true;
  } catch {
    // Event not found or access denied
    return router.createUrlTree(['/404']);
  }
};
