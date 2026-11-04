import { inject } from '@angular/core';
import { type ResolveFn } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../core/effect-rpc-angular-client';

// Load the destination before swapping details so its title, icon, and shape
// update together without an intermediate loading header.
export const eventDetailsReadyResolver: ResolveFn<void> = (route) => {
  const eventId = route.paramMap.get('eventId');
  if (!eventId) throw new Error('Event details route is missing its event ID');
  const rpc = AppRpc.injectClient();
  // Prefetch keeps failures in the query cache for the detail page's existing
  // error/retry UI instead of cancelling navigation to an unavailable event.
  return inject(QueryClient).prefetchQuery(
    rpc.events.findOne.queryOptions({ id: eventId }),
  );
};
