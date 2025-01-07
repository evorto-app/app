import { inject, Injectable, Signal } from '@angular/core';
import {
  mutationOptions,
  QueryClient,
  queryOptions,
} from '@tanstack/angular-query-experimental';

import { type AppRouter } from '../../server/trpc/app-router';
import { injectTrpcClient } from './trpc-client';

@Injectable({
  providedIn: 'root',
})
export class QueriesService {
  private queryClient = inject(QueryClient);
  private trpcClient = injectTrpcClient();

  public createEvent() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['events']['create']['_def']['$types']['input'],
        ) => this.trpcClient.events.create.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['events'],
          });
        },
      });
  }

  public createTemplate() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['templates']['create']['_def']['$types']['input'],
        ) => this.trpcClient.templates.create.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['templatesByCategory'],
          });
          this.queryClient.invalidateQueries({
            queryKey: ['templates'],
          });
        },
      });
  }

  public event(eventId: Signal<string>) {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.events.findOne.query({ id: eventId() }),
        queryKey: ['event', eventId()],
      });
  }

  public events() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.events.findMany.query(),
        queryKey: ['events'],
      });
  }

  public template(templateId: Signal<string>) {
    return () =>
      queryOptions({
        queryFn: () =>
          this.trpcClient.templates.findOne.query({ id: templateId() }),
        queryKey: ['template', templateId()],
      });
  }

  public templateCategories() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.templateCategories.findMany.query(),
        queryKey: ['templateCategories'],
      });
  }
}
