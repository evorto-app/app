import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { PermissionsService } from '../../core/permissions.service';
import { QueriesService } from '../../core/queries.service';

export const eventEditGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const queries = inject(QueriesService);
  const permissions = inject(PermissionsService);
  const eventId = route.params['id'];

  if (!permissions.hasPermissionSync('events:edit')) {
    return router.createUrlTree(['/403']);
  }

  try {
    const event = await firstValueFrom(queries.event(eventId).result$);
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
