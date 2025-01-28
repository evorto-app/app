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

  public createRole() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['admin']['roles']['create']['_def']['$types']['input'],
        ) => this.trpcClient.admin.roles.create.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['roles'],
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

  public createTenant() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['globalAdmin']['tenants']['create']['_def']['$types']['input'],
        ) => this.trpcClient.globalAdmin.tenants.create.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['tenants'],
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

  public deleteRole() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['admin']['roles']['delete']['_def']['$types']['input'],
        ) => this.trpcClient.admin.roles.delete.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['roles'],
          });
        },
      });
  }

  public deleteTenant() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['globalAdmin']['tenants']['delete']['_def']['$types']['input'],
        ) => this.trpcClient.globalAdmin.tenants.delete.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['tenants'],
          });
        },
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

  public isAuthenticated() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.config.isAuthenticated.query(),
        queryKey: ['config', 'isAuthenticated'],
      });
  }

  public permissions() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.config.permissions.query(),
        queryKey: ['config', 'permissions'],
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

  public role(id: Signal<string>) {
    return () =>
      queryOptions({
        queryFn: () =>
          this.trpcClient.admin.roles.findOne.query({
            id: id(),
          }),
        queryKey: ['roles', id()],
      });
  }

  public roles() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.admin.roles.findMany.query(),
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

  public self() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.users.self.query(),
        queryKey: ['users', 'self'],
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

  public tenant(id: Signal<string>) {
    return () =>
      queryOptions({
        queryFn: () =>
          this.trpcClient.globalAdmin.tenants.findOne.query({
            id: id(),
          }),
        queryKey: ['tenants', id()],
      });
  }

  public tenants() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.globalAdmin.tenants.findMany.query(),
        queryKey: ['tenants'],
      });
  }

  public updateRole() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['admin']['roles']['update']['_def']['$types']['input'],
        ) => this.trpcClient.admin.roles.update.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['roles'],
          });
        },
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

  public updateTenant() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['globalAdmin']['tenants']['update']['_def']['$types']['input'],
        ) => this.trpcClient.globalAdmin.tenants.update.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['tenants'],
          });
        },
      });
  }

  public users() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.users.findMany.query(),
        queryKey: ['users'],
      });
  }
}
