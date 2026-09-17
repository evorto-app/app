import { DOCUMENT, PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { toClientTenantConfig } from '../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { Tenant } from '../../types/custom/tenant';
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
      esnCard: { config: {}, status: 'disabled' },
    },
    domain: 'section.example.test',
    id: `tenant-${theme}`,
    maxActiveRegistrationsPerUser: 3,
    name: 'Section',
    receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
    refundFeesOnCancellation: false,
    stripeAccountId,
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
      .mockResolvedValueOnce(toClientTenantConfig(createTenant('evorto')))
      .mockResolvedValueOnce(toClientTenantConfig(createTenant('classic')))
      .mockResolvedValueOnce(toClientTenantConfig(createTenant('esn')));

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
    ['theme-evorto', 'theme-classic', 'theme-esn'].filter((themeClass) =>
      TestBed.inject(DOCUMENT).documentElement.classList.contains(themeClass),
    );

  const configuredThemeColors = () =>
    Array.from(
      TestBed.inject(DOCUMENT).querySelectorAll<HTMLMetaElement>(
        'meta[name="theme-color"]',
      ),
      (tag) => ({ content: tag.content, media: tag.getAttribute('media') }),
    );

  afterEach(() => {
    document.documentElement.classList.remove(
      'theme-evorto',
      'theme-classic',
      'theme-esn',
    );
    for (const tag of document.querySelectorAll('meta[name="theme-color"]')) {
      tag.remove();
    }
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  it('fails visibly when Angular did not provide request context', async () => {
    const publicConfigCall = vi.fn();
    queryClient = new QueryClient({
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

  it('applies exactly the current theme without waiting for the tenant query', async () => {
    const config = configure();

    await config.initialize();
    expect(configuredThemeClasses()).toEqual(['theme-evorto']);
    expect(configuredThemeColors()).toEqual([
      { content: '#fcf9f2', media: '(prefers-color-scheme: light)' },
      { content: '#131410', media: '(prefers-color-scheme: dark)' },
    ]);

    await config.initialize();
    expect(configuredThemeClasses()).toEqual(['theme-classic']);
    expect(configuredThemeColors()).toEqual([
      { content: '#f6fafd', media: '(prefers-color-scheme: light)' },
      { content: '#0f1416', media: '(prefers-color-scheme: dark)' },
    ]);

    await config.initialize();
    expect(configuredThemeClasses()).toEqual(['theme-esn']);
    expect(configuredThemeColors()).toEqual([
      { content: '#f5faff', media: '(prefers-color-scheme: light)' },
      { content: '#0f1418', media: '(prefers-color-scheme: dark)' },
    ]);
  });

  it.each([
    { dark: '#0f1416', light: '#f6fafd', theme: 'classic' },
    { dark: '#131410', light: '#fcf9f2', theme: 'evorto' },
    { dark: '#0f1418', light: '#f5faff', theme: 'esn' },
  ] as const)(
    'applies the request $theme theme and browser chrome colors during server initialization',
    async ({ dark, light, theme }) => {
      const config = configure(createTenant(theme));

      await config.initialize();

      expect(configuredThemeClasses()).toEqual([`theme-${theme}`]);
      expect(configuredThemeColors()).toEqual([
        { content: light, media: '(prefers-color-scheme: light)' },
        { content: dark, media: '(prefers-color-scheme: dark)' },
      ]);
    },
  );

  it('refreshes browser chrome colors when the tenant query changes', async () => {
    const config = configure();

    await config.initialize();
    TestBed.tick();
    queryClient.setQueryData(
      ['config', 'tenant'],
      toClientTenantConfig(createTenant('esn')),
    );

    await vi.waitFor(() => {
      TestBed.tick();
      expect(configuredThemeClasses()).toEqual(['theme-esn']);
      expect(configuredThemeColors()).toEqual([
        { content: '#f5faff', media: '(prefers-color-scheme: light)' },
        { content: '#0f1418', media: '(prefers-color-scheme: dark)' },
      ]);
    });
  });
  it('sanitizes the server request context before exposing tenant configuration', async () => {
    queryClient = new QueryClient({
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
                call: vi.fn().mockResolvedValue({
                  googleMapsApiKey: 'maps-key',
                }),
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
