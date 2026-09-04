import { DOCUMENT, PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tenant } from '../../types/custom/tenant';
import { ConfigService } from './config.service';
import { APP_RPC_CLIENT } from './effect-rpc-angular-client';

const createTenant = (theme: Tenant['theme']) =>
  new Tenant({
    cancellationDeadlineHoursBeforeStart: 24,
    currency: 'EUR',
    defaultLocation: undefined,
    discountProviders: {
      esnCard: { config: {}, status: 'disabled' },
    },
    domain: 'section.example.test',
    id: `tenant-${theme}`,
    locale: 'de-DE',
    maxActiveRegistrationsPerUser: 3,
    name: 'Section',
    receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
    refundFeesOnCancellation: false,
    theme,
    timezone: 'Europe/Berlin',
    transferDeadlineHoursBeforeStart: 24,
  });

describe('ConfigService theme initialization', () => {
  let queryClient: QueryClient;

  const configure = (requestTenant?: Tenant) => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tenantCall = vi
      .fn()
      .mockResolvedValueOnce(createTenant('evorto'))
      .mockResolvedValueOnce(createTenant('esn'));

    TestBed.configureTestingModule({
      providers: [
        ConfigService,
        provideTanStackQuery(queryClient),
        {
          provide: PLATFORM_ID,
          useValue: requestTenant ? 'server' : 'browser',
        },
        {
          provide: REQUEST_CONTEXT,
          useValue: requestTenant
            ? { permissions: [], tenant: requestTenant }
            : null,
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            config: {
              permissions: { call: vi.fn().mockResolvedValue([]) },
              platformAuthority: { call: vi.fn().mockResolvedValue(null) },
              public: {
                call: vi
                  .fn()
                  .mockResolvedValue({ googleMapsApiKey: 'maps-key' }),
              },
              tenant: {
                call: tenantCall,
                queryOptions: () => ({
                  enabled: false,
                  queryFn: tenantCall,
                  queryKey: ['config', 'tenant'],
                }),
              },
            },
          },
        },
      ],
    });

    return TestBed.inject(ConfigService);
  };

  const configuredThemeClasses = () =>
    ['theme-evorto', 'theme-esn'].filter((themeClass) =>
      TestBed.inject(DOCUMENT).documentElement.classList.contains(themeClass),
    );

  afterEach(() => {
    document.documentElement.classList.remove('theme-evorto', 'theme-esn');
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  it('applies exactly the current theme without waiting for the tenant query', async () => {
    const config = configure();

    await config.initialize();
    expect(configuredThemeClasses()).toEqual(['theme-evorto']);

    await config.initialize();
    expect(configuredThemeClasses()).toEqual(['theme-esn']);
  });

  it('applies the request tenant theme during server initialization', async () => {
    const config = configure(createTenant('esn'));

    await config.initialize();

    expect(configuredThemeClasses()).toEqual(['theme-esn']);
  });
});
