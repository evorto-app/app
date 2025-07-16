import { inject, Injectable, Signal } from '@angular/core';
import {
  keepPreviousData,
  mutationOptions,
  QueryClient,
  queryOptions,
} from '@tanstack/angular-query-experimental';

import { type AppRouter } from '../../server/trpc/app-router';
import { injectTRPCClient } from './trpc-client';

@Injectable({
  providedIn: 'root',
})
export class QueriesService {
  private queryClient = inject(QueryClient);
  private trpcClient = injectTRPCClient();

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

  public addIconByName() {
    return () => {
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
    };
  }

  public authData() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.users.authData.query(),
        queryKey: ['authData'],
        refetchInterval: 1000 * 20,
      });
  }

  public cancelPendingRegistration() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['events']['cancelPendingRegistration']['_def']['$types']['input'],
        ) => this.trpcClient.events.cancelPendingRegistration.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['events'],
          });
        },
      });
  }

  public createAccount() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['users']['createAccount']['_def']['$types']['input'],
        ) => this.trpcClient.users.createAccount.mutate(input),
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

  public defaultOrganizerRoles() {
    return () =>
      queryOptions({
        queryFn: () =>
          this.trpcClient.admin.roles.findMany.query({
            defaultOrganizerRole: true,
          }),
        queryKey: ['roles', 'defaultOrganizerRole'],
      });
  }

  public defaultUserRoles() {
    return () =>
      queryOptions({
        queryFn: () =>
          this.trpcClient.admin.roles.findMany.query({ defaultUserRole: true }),
        queryKey: ['roles', 'defaultUserRole'],
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

  public eventList(
    input: Signal<AppRouter['events']['eventList']['_def']['$types']['input']>,
  ) {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.events.eventList.query(input()),
        queryKey: ['events', input()],
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
        refetchInterval: 1000 * 20,
      });
  }

  public events(
    input: Signal<AppRouter['events']['eventList']['_def']['$types']['input']>,
  ) {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.events.findMany.query(input()),
        queryKey: ['events', input()],
      });
  }

  public isAuthenticated() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.config.isAuthenticated.query(),
        queryKey: ['config', 'isAuthenticated'],
      });
  }

  public maybeSelf() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.users.maybeSelf.query(),
        queryKey: ['self'],
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

  public registrationScanned(id: Signal<string>) {
    return () =>
      queryOptions({
        queryFn: () =>
          this.trpcClient.events.registrationScanned.query({
            registrationId: id(),
          }),
        queryKey: ['registrationScanned', id()],
      });
  }

  public reviewEvent() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['events']['reviewEvent']['_def']['$types']['input'],
        ) => this.trpcClient.events.reviewEvent.mutate(input),
        onSuccess: (data) => {
          this.queryClient.invalidateQueries({ queryKey: ['events'] });
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
        queryFn: () => this.trpcClient.admin.roles.findMany.query({}),
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

  public searchRoles(search: Signal<string>) {
    return () =>
      queryOptions({
        queryFn: () =>
          this.trpcClient.admin.roles.search.query({ search: search() }),
        queryKey: ['roles', 'search', search()],
      });
  }

  public self() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.users.self.query(),
        queryKey: ['self'],
      });
  }

  public submitEventForReview() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['events']['submitForReview']['_def']['$types']['input'],
        ) => this.trpcClient.events.submitForReview.mutate(input),
        onSuccess: (data) => {
          this.queryClient.invalidateQueries({ queryKey: ['events'] });
        },
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

  public transactions(
    input: Signal<
      AppRouter['finance']['transactions']['findMany']['_def']['$types']['input']
    >,
  ) {
    return () =>
      queryOptions({
        placeholderData: keepPreviousData,
        queryFn: () =>
          this.trpcClient.finance.transactions.findMany.query(input()),
        queryKey: ['transactions', input()],
      });
  }

  public updateEvent() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['events']['update']['_def']['$types']['input'],
        ) => this.trpcClient.events.update.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({ queryKey: ['events'] });
        },
      });
  }

  public updateEventVisibility() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['events']['updateVisibility']['_def']['$types']['input'],
        ) => this.trpcClient.events.updateVisibility.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({ queryKey: ['events'] });
        },
      });
  }

  public updateProfile() {
    return () =>
      mutationOptions({
        mutationFn: (input: { firstName: string; lastName: string }) =>
          this.trpcClient.users.updateProfile.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['self'],
          });
        },
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
          this.queryClient.invalidateQueries({
            queryKey: ['templatesByCategory'],
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

  public updateTenantSettings() {
    return () =>
      mutationOptions({
        mutationFn: (
          input: AppRouter['admin']['tenant']['updateSettings']['_def']['$types']['input'],
        ) => this.trpcClient.admin.tenant.updateSettings.mutate(input),
        onSuccess: () => {
          this.queryClient.invalidateQueries({
            queryKey: ['tenants'],
          });
          this.queryClient.invalidateQueries({
            queryKey: ['config', 'tenant'],
          });
        },
      });
  }

  public userEvents() {
    return () =>
      queryOptions({
        queryFn: () => this.trpcClient.users.events.findMany.query(),
        queryKey: ['userEvents'],
      });
  }

  public users(
    input: Signal<AppRouter['users']['findMany']['_def']['$types']['input']>,
  ) {
    return () =>
      queryOptions({
        placeholderData: keepPreviousData,
        queryFn: () => this.trpcClient.users.findMany.query(input()),
        queryKey: ['users', input()],
      });
  }
}
