import { inject, Injectable } from '@angular/core';
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

  public templateCategories() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.templateCategories.findMany.query(),
        queryKey: ['templateCategories'],
      });
  }
}
