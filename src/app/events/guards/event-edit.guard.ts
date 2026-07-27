import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { PermissionsService } from '../../core/permissions.service';
import { eventRouteErrorPath } from '../event-rpc-error';

export const eventEditGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const rpc = AppRpc.injectClient();
  const permissions = inject(PermissionsService);
  const eventId = route.params['eventId'] as string | undefined;

  if (!eventId) {
    return router.createUrlTree(['/404']);
  }

  try {
    const event = await rpc.events.findOne.call({ id: eventId });
    const canEditAll = permissions.hasPermissionSync('events:editAll');
    const canEdit = canEditAll || event.userIsCreator;
    if (!canEdit) {
      return router.createUrlTree(['/403']);
    }
    if (event.status !== 'DRAFT') {
      return router.createUrlTree(['/events', eventId], {
        queryParams: { error: 'event-locked' },
      });
    }
    return true;
  } catch (error) {
    return router.createUrlTree([eventRouteErrorPath(error)]);
  }
};
