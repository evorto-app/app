import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { PermissionsService } from '../../core/permissions.service';
import { injectTRPCClient } from '../../core/trpc-client';

export const eventEditGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const rpc = AppRpc.injectClient();
  const trpc = injectTRPCClient();
  const permissions = inject(PermissionsService);
  const eventId = route.params['eventId'] as string | undefined;

  if (!eventId) {
    return router.createUrlTree(['/404']);
  }

  try {
    const self = await rpc.users.maybeSelf.call();
    const event = await trpc.events.findOne.query({ id: eventId });
    const canEditAll = permissions.hasPermissionSync('events:editAll');
    const canEdit = canEditAll || self?.id === event.creatorId;
    if (!canEdit) {
      return router.createUrlTree(['/403']);
    }
    if (event.status !== 'DRAFT' && event.status !== 'REJECTED') {
      return router.createUrlTree(['/events', eventId], {
        queryParams: { error: 'event-locked' },
      });
    }
    return true;
  } catch {
    return router.createUrlTree(['/404']);
  }
};
