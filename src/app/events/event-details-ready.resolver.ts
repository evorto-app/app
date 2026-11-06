import { inject } from '@angular/core';
import { type ResolveFn } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../core/effect-rpc-angular-client';
import { eventLoadErrorTitle } from './event-rpc-error';

// Load the destination before swapping details so its title, icon, and shape
// update together without an intermediate loading header.
export const eventDetailsReadyResolver: ResolveFn<string> = async (route) => {
  const eventId = route.paramMap.get('eventId');
  if (!eventId) throw new Error('Event details route is missing its event ID');
  const rpc = AppRpc.injectClient();
  // Prefetch keeps failures in the query cache for the detail page's existing
  // error/retry UI instead of cancelling navigation to an unavailable event.
  const queryClient = inject(QueryClient);
  const options = rpc.events.findOne.queryOptions({ id: eventId });
  await queryClient.prefetchQuery(options);
  const event = queryClient.getQueryData<
    Awaited<ReturnType<typeof rpc.events.findOne.call>>
  >(options.queryKey);
  const state = queryClient.getQueryState(options.queryKey);
  if (!event || state?.status !== 'success')
    return eventLoadErrorTitle(state?.error);
  const action = route.data['eventTitleAction'];
  return typeof action === 'string' ? `${action} ${event.title}` : event.title;
};
