import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { PermissionsService } from '../../core/permissions.service';

export const eventEditGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const queryClient = inject(QueryClient);
  const rpc = AppRpc.injectClient();
  const permissions = inject(PermissionsService);
  const eventId = route.params['eventId'] as string | undefined;

  if (!eventId) {
    return router.createUrlTree(['/404']);
  }

  try {
    const self = await rpc.users.maybeSelf.call();
    const event = await queryClient.fetchQuery(
      rpc.events.findOne.queryOptions({ id: eventId }),
    );
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
