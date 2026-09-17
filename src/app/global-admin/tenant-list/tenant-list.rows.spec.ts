import type { GlobalAdminTenantRecord } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { createRpcQueryKey } from '@heddendorp/effect-angular-query';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { TenantListComponent } from './tenant-list.component';
import {
  filterGlobalAdminTenants,
  globalAdminPaymentStatusLabel,
  globalAdminTenantRows,
} from './tenant-list.rows';

const tenant = {
  currency: 'EUR',
  domain: 'tenant.example.com',
  id: 'tenant-1',
  name: 'Tenant',
  paymentsConfigured: true,
  theme: 'esn',
  timezone: 'Europe/Berlin',
} as const satisfies GlobalAdminTenantRecord;

describe('globalAdminTenantRows', () => {
  it('summarizes organization settings for platform review', () => {
    expect(globalAdminTenantRows(tenant)).toEqual([
      { label: 'Website address', value: 'tenant.example.com' },
      { label: 'Theme', value: 'ESN theme' },
      { label: 'Currency', value: 'EUR' },
      { label: 'Time zone', value: 'Berlin time' },
      { label: 'Payments', value: 'Paid sign-ups ready' },
    ]);
  });

  it('reuses the settings rows for organization detail review', () => {
    expect(globalAdminTenantRows(tenant).map((row) => row.label)).toEqual([
      'Website address',
      'Theme',
      'Currency',
      'Time zone',
      'Payments',
    ]);
  });

  it('shows when paid sign-ups need attention', () => {
    const rows = globalAdminTenantRows({
      ...tenant,
      currency: 'EUR',
      domain: 'tenant.example.com',
      id: 'tenant-1',
      name: 'Tenant',
      paymentsConfigured: false,
      theme: 'evorto',
    });

    expect(rows.at(-1)).toEqual({
      label: 'Payments',
      value: 'Paid sign-ups need attention',
    });
  });
});

describe('globalAdminPaymentStatusLabel', () => {
  it('shows payment readiness without exposing provider details', () => {
    expect(
      globalAdminPaymentStatusLabel({
        paymentsConfigured: true,
      }),
    ).toBe('Paid sign-ups ready');
  });

  it('keeps unavailable paid sign-ups explicit', () => {
    expect(
      globalAdminPaymentStatusLabel({
        paymentsConfigured: true,
      }),
    ).toBe('Paid sign-ups ready');
    expect(
      globalAdminPaymentStatusLabel({
        paymentsConfigured: false,
      }),
    ).toBe('Paid sign-ups need attention');
  });
});

describe('filterGlobalAdminTenants', () => {
  it('returns all tenants for blank searches', () => {
    expect(filterGlobalAdminTenants([tenant], ' '.repeat(3))).toEqual([tenant]);
  });

  it('matches tenant operational fields case-insensitively', () => {
    const secondTenant = {
      ...tenant,
      currency: 'AUD',
      domain: 'north.example.com',
      id: 'tenant-2',
      name: 'North',
      paymentsConfigured: false,
      theme: 'evorto',
      timezone: 'Australia/Brisbane',
    } as const satisfies GlobalAdminTenantRecord;

    expect(filterGlobalAdminTenants([tenant, secondTenant], 'north')).toEqual([
      secondTenant,
    ]);
    expect(filterGlobalAdminTenants([tenant, secondTenant], 'BERLIN')).toEqual([
      tenant,
    ]);
    expect(
      filterGlobalAdminTenants([tenant, secondTenant], 'need attention'),
    ).toEqual([secondTenant]);
    expect(
      filterGlobalAdminTenants(
        [tenant, secondTenant],
        'paid sign-ups need attention',
      ),
    ).toEqual([secondTenant]);
    expect(
      filterGlobalAdminTenants([tenant, secondTenant], 'acct_123'),
    ).toEqual([]);
  });
});

const withTenantListFailure = async (
  error: unknown,
  check: (context: {
    fixture: ComponentFixture<TenantListComponent>;
    loadTenants: ReturnType<
      typeof vi.fn<() => Promise<readonly GlobalAdminTenantRecord[]>>
    >;
    registerRelease: (release: () => void) => void;
    root: HTMLElement;
  }) => Promise<void>,
) => {
  const failures: unknown[] = [];
  const releases: (() => void)[] = [];
  let queryClient: QueryClient | undefined;
  let fixture: ComponentFixture<TenantListComponent> | undefined;
  try {
    queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: 0, retry: false } },
    });
    const loadTenants = vi
      .fn<() => Promise<readonly GlobalAdminTenantRecord[]>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValue([tenant]);
    await TestBed.configureTestingModule({
      imports: [TenantListComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            globalAdmin: {
              tenants: {
                findMany: {
                  queryOptions: () => ({
                    queryFn: loadTenants,
                    queryKey: createRpcQueryKey(
                      ['globalAdmin', 'tenants', 'findMany'],
                      {
                        keyPrefix: 'rpc',
                        type: 'query',
                      },
                    ),
                  }),
                },
              },
            },
          },
        },
      ],
    }).compileComponents();
    const acquiredFixture = TestBed.createComponent(TenantListComponent);
    fixture = acquiredFixture;
    const root: unknown = acquiredFixture.nativeElement;
    if (!(root instanceof HTMLElement))
      throw new Error('Expected organization list element');
    await vi.waitFor(async () => {
      acquiredFixture.detectChanges();
      await acquiredFixture.whenStable();
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(
        'Organizations could not be loaded. Try again.',
      );
    });
    expect(loadTenants).toHaveBeenCalledTimes(1);
    expect(root.textContent).not.toContain(
      'Global admin permission is required',
    );
    expect(root.textContent).not.toContain('RpcForbiddenError');
    await check({
      fixture: acquiredFixture,
      loadTenants,
      registerRelease: (release) => {
        releases.push(release);
      },
      root,
    });
  } catch (error_) {
    failures.push(error_);
  }
  const cleanup: readonly ((() => Promise<unknown>) | (() => void))[] = [
    ...releases,
    async () => {
      await queryClient?.cancelQueries();
    },
    () => fixture?.destroy(),
    () => queryClient?.clear(),
    () => vi.restoreAllMocks(),
    () => TestBed.resetTestingModule(),
  ];
  for (const release of cleanup) {
    try {
      await release();
    } catch (error_) {
      failures.push(error_);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      'Organization list assertions and cleanup failed',
    );
};

describe('TenantListComponent load outcomes', () => {
  for (const failure of [
    { error: null, name: 'null' },
    { error: { _tag: 'RpcForbiddenError' }, name: 'forbidden' },
    {
      error: { message: 'Global admin permission is required' },
      name: 'raw message',
    },
  ]) {
    it(`keeps tenant-list load failures readable for ${failure.name}`, async () => {
      await withTenantListFailure(failure.error, ({ root }) => {
        const button = root.querySelector('button');
        if (!(button instanceof HTMLButtonElement))
          throw new Error('Expected organization read retry');
        expect(button.textContent?.trim()).toBe('Try again');
        expect(button.disabled).toBe(false);
        return Promise.resolve();
      });
    });
  }

  it('retries only the failed organization read and waits for its rows', async () => {
    await withTenantListFailure(
      { message: 'Global admin permission is required' },
      async ({ fixture, loadTenants, registerRelease, root }) => {
        let resolveRead: (() => void) | undefined;
        // Angular's browser target does not expose Promise.withResolvers.

        const read = new Promise<readonly GlobalAdminTenantRecord[]>(
          (resolve) => {
            resolveRead = () => resolve([tenant]);
          },
        );
        if (!resolveRead) throw new Error('Expected owned organization read');
        registerRelease(resolveRead);
        loadTenants.mockReturnValueOnce(read);
        const retry = root.querySelector('button');
        if (!(retry instanceof HTMLButtonElement))
          throw new Error('Expected organization read retry');
        retry.click();
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(loadTenants).toHaveBeenCalledTimes(2);
          expect(root.textContent).toContain('Loading organizations');
          expect(root.querySelector('button')).toBeNull();
        });
        resolveRead();
        await vi.waitFor(async () => {
          fixture.detectChanges();
          await fixture.whenStable();
          expect(root.textContent).toContain('tenant.example.com');
        });
        expect(root.textContent).toContain('Paid sign-ups ready');
        expect(root.querySelector('[role="alert"]')).toBeNull();
        expect(loadTenants).toHaveBeenCalledTimes(2);
      },
    );
  });
});
