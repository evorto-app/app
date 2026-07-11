import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { appQueryProviders } from './app-query-client';

describe('appQueryProviders', () => {
  it('creates an isolated query cache for each application injector', () => {
    const platformInjector = TestBed.inject(EnvironmentInjector);
    const createApplicationInjector = () =>
      createEnvironmentInjector([...appQueryProviders], platformInjector);
    const firstApplication = createApplicationInjector();
    const secondApplication = createApplicationInjector();

    try {
      const firstClient = firstApplication.get(QueryClient);
      const secondClient = secondApplication.get(QueryClient);
      const permissionQueryKey = ['events', 'canOrganize', 'event-1'];

      firstClient.setQueryData(permissionQueryKey, true);

      expect(secondClient).not.toBe(firstClient);
      expect(secondClient.getQueryData(permissionQueryKey)).toBeUndefined();
    } finally {
      firstApplication.destroy();
      secondApplication.destroy();
    }
  });
});
