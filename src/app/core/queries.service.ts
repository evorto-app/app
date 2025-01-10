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

  public addIcon() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['icons']['addIcon']['_def']['$types']['input'],
        ) => this.trpcClient.icons.addIcon.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['icons'],
          });
        },
      });
  }

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

  public createSimpleTemplate() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['templates']['createSimpleTemplate']['_def']['$types']['input'],
        ) => this.trpcClient.templates.createSimpleTemplate.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['templates'],
          });
        },
      });
  }

  public createTemplateCategory() {
    return () =>
      mutationOptions({
        mutationFn: (input: { icon: string; title: string }) =>
          this.trpcClient.templateCategories.create.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['templateCategories'],
          });
        },
      });
  }

  public currentTenant() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.config.tenant.query(),
        queryKey: ['config', 'tenant'],
      });
  }

  public event(eventId: Signal<string>) {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.events.findOne.query({ id: eventId() }),
        queryKey: ['events', eventId()],
      });
  }

  public eventRegistrationStatus(eventId: Signal<string>) {
    return () =>
      queryOptions({
        queryFn: () =>
          this.trpcClient.events.getRegistrationStatus.query({
            eventId: eventId(),
          }),
        queryKey: ['events', eventId(), 'registration-status'],
      });
  }

  public events() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.events.findMany.query(),
        queryKey: ['events'],
      });
  }

  public registerForEvent() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['events']['registerForEvent']['_def']['$types']['input'],
        ) => this.trpcClient.events.registerForEvent.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['events'],
          });
        },
      });
  }

  public role(roleId: Signal<string>) {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.roles.findOne.query({ id: roleId() }),
        queryKey: ['roles', roleId()],
      });
  }

  public roles() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.roles.findMany.query(),
        queryKey: ['roles'],
      });
  }

  public searchIcons(query: Signal<string>) {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.icons.search.query({ search: query() }),
        queryKey: ['icons', query()],
      });
  }

  public template(templateId: Signal<string>) {
    return () =>
      queryOptions({
        queryFn: () =>
          this.trpcClient.templates.findOne.query({ id: templateId() }),
        queryKey: ['templates', templateId()],
      });
  }

  public templateCategories() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.templateCategories.findMany.query(),
        queryKey: ['templateCategories'],
      });
  }

  public templatesByCategory() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.templates.groupedByCategory.query(),
        queryKey: ['templatesByCategory'],
      });
  }

  public tenants() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.tenants.findMany.query(),
        queryKey: ['tenants'],
      });
  }

  public updateSimpleTemplate() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['templates']['updateSimpleTemplate']['_def']['$types']['input'],
        ) => this.trpcClient.templates.updateSimpleTemplate.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['templates'],
          });
        },
      });
  }

  public updateTemplateCategory() {
    return () =>
      mutationOptions({
        mutationFn: (input: { id: string; title: string }) =>
          this.trpcClient.templateCategories.update.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['templateCategories'],
          });
        },
      });
  }
}
