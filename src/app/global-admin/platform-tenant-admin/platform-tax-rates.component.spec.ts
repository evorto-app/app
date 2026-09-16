import { TestBed } from '@angular/core/testing';
import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../../core/notification.service';
import {
  PlatformTaxRatesComponent,
  PlatformTaxRatesOperations,
} from './platform-tax-rates.component';

describe('platform tax-rate import error notifications', () => {
  const importRates = vi.fn();
  const showError = vi.fn();
  let queryClient: QueryClient;

  beforeEach(async () => {
    importRates.mockReset();
    showError.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    TestBed.overrideComponent(PlatformTaxRatesComponent, {
      set: {
        template: `
      <button type="button" (click)="importForm.ids().value.set(['rate-1']); importForm.reason().value.set('Repair tenant tax setup'); importRates($event)">Import selected</button>
    `,
      },
    });
    await TestBed.configureTestingModule({
      imports: [PlatformTaxRatesComponent],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: NotificationService,
          useValue: { showError, showSuccess: vi.fn() },
        },
        {
          provide: PlatformTaxRatesOperations,
          useValue: {
            import: () => ({ mutationFn: importRates }),
            list: () => ({
              queryFn: async () => [],
              queryKey: ['platform-tax-rates'],
            }),
            taxRatesFilter: () => ({ queryKey: ['platform-tax-rates'] }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  it.each([
    {
      error: new RpcBadRequestError({
        message:
          'The target tenant Stripe account changed while tax rates were being loaded; retry the import',
      }),
      expected:
        'The target tenant Stripe account changed while tax rates were being loaded; retry the import',
    },
    {
      error: new RpcBadRequestError({
        message: 'Stripe tax rate rate-1 must be active and inclusive',
      }),
      expected: 'Stripe tax rate rate-1 must be active and inclusive',
    },
    {
      error: new RpcInternalServerError({
        message: 'private provider details',
      }),
      expected: 'Failed to import tax rates',
    },
    {
      error: new RpcForbiddenError({
        message: 'private authorization details',
      }),
      expected: 'Failed to import tax rates',
    },
    {
      error: new Error('private transport details'),
      expected: 'Failed to import tax rates',
    },
  ])(
    'reports only actionable safe import guidance: $expected',
    async ({ error, expected }) => {
      importRates.mockRejectedValueOnce(error);
      const fixture = TestBed.createComponent(PlatformTaxRatesComponent);
      fixture.componentRef.setInput('tenantId', 'tenant-1');
      fixture.detectChanges();
      const button: HTMLButtonElement | null =
        fixture.nativeElement.querySelector('button');
      if (!button) throw new Error('Import button not rendered');
      button.click();
      await vi.waitFor(() =>
        expect(showError).toHaveBeenCalledExactlyOnceWith(expected),
      );
      expect(importRates).toHaveBeenCalledWith(
        {
          ids: ['rate-1'],
          reason: 'Repair tenant tax setup',
          targetTenantId: 'tenant-1',
        },
        expect.anything(),
      );
    },
  );
});
