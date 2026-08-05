import { DOCUMENT, PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { toClientTenantConfig } from '../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { supportedTenantThemes, Tenant } from '../../types/custom/tenant';
import {
  ConfigService,
  ServerRequestContextRequiredError,
} from './config.service';
import { APP_RPC_CLIENT } from './effect-rpc-angular-client';

const createTenant = (theme: Tenant['theme'], stripeAccountId?: string) =>
  new Tenant({
    cancellationDeadlineHoursBeforeStart: 24,
    currency: 'EUR',
    defaultLocation: undefined,
    discountProviders: {
      esnCard: {
        config: {},
        status: 'disabled',
      },
    },
    domain: 'section.example.test',
    id: `tenant-${theme}`,
    maxActiveRegistrationsPerUser: 3,
    name: 'Section',
    receiptSettings: {
      allowOther: false,
      receiptCountries: ['DE'],
    },
    refundFeesOnCancellation: false,
    stripeAccountId,
    theme,
    timezone: 'Europe/Berlin',
    transferDeadlineHoursBeforeStart: 24,
  });

describe('ConfigService initialization', () => {
  afterEach(() => {
    for (const theme of supportedTenantThemes) {
      document.documentElement.classList.remove(`theme-${theme}`);
    }
    TestBed.resetTestingModule();
  });

  it('fails visibly when Angular did not provide request context', async () => {
    const publicConfigCall = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    TestBed.configureTestingModule({
      providers: [
        ConfigService,
        provideTanStackQuery(queryClient),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: REQUEST_CONTEXT, useValue: null },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            config: {
              public: {
                call: publicConfigCall,
              },
              tenant: {
                queryOptions: () => ({
                  enabled: false,
                  queryFn: vi.fn(),
                  queryKey: ['config', 'tenant'],
                }),
              },
            },
          },
        },
      ],
    });

    const config = TestBed.inject(ConfigService);

    await expect(config.initialize()).rejects.toBeInstanceOf(
      ServerRequestContextRequiredError,
    );
    expect(publicConfigCall).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it('applies exactly one current tenant theme during initialization', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const tenantCall = vi
      .fn()
      .mockResolvedValueOnce(toClientTenantConfig(createTenant('evorto')))
      .mockResolvedValueOnce(toClientTenantConfig(createTenant('classic')))
      .mockResolvedValueOnce(toClientTenantConfig(createTenant('esn')));

    TestBed.configureTestingModule({
      providers: [
        ConfigService,
        provideTanStackQuery(queryClient),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: REQUEST_CONTEXT, useValue: null },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            config: {
              permissions: {
                call: vi.fn().mockResolvedValue([]),
              },
              platformAuthority: {
                call: vi.fn().mockResolvedValue(null),
              },
              public: {
                call: vi.fn().mockResolvedValue({ googleMapsApiKey: null }),
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

    const config = TestBed.inject(ConfigService);
    const configuredThemeClasses = () =>
      supportedTenantThemes
        .map((theme) => `theme-${theme}`)
        .filter((themeClass) =>
          TestBed.inject(DOCUMENT).documentElement.classList.contains(
            themeClass,
          ),
        );

    await config.initialize();
    expect(configuredThemeClasses()).toEqual(['theme-evorto']);

    await config.initialize();
    expect(configuredThemeClasses()).toEqual(['theme-classic']);

    await config.initialize();
    expect(configuredThemeClasses()).toEqual(['theme-esn']);
    queryClient.clear();
  });

  it('sanitizes the server request context before exposing tenant configuration', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const tenant = createTenant('evorto', 'acct_server-only');

    TestBed.configureTestingModule({
      providers: [
        ConfigService,
        provideTanStackQuery(queryClient),
        { provide: PLATFORM_ID, useValue: 'server' },
        {
          provide: REQUEST_CONTEXT,
          useValue: {
            permissions: [],
            platformAuthority: undefined,
            tenant,
          },
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            config: {
              public: {
                call: vi.fn().mockResolvedValue({ googleMapsApiKey: null }),
              },
              tenant: {
                queryOptions: () => ({
                  enabled: false,
                  queryFn: vi.fn(),
                  queryKey: ['config', 'tenant'],
                }),
              },
            },
          },
        },
      ],
    });

    const config = TestBed.inject(ConfigService);

    await config.initialize();

    expect(tenant.stripeAccountId).toBe('acct_server-only');
    expect(config.tenant.paymentsConfigured).toBe(true);
    expect(config.tenant).not.toHaveProperty('stripeAccountId');
    queryClient.clear();
  });
});
