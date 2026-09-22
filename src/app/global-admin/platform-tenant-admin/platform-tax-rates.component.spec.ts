import { Component, input } from '@angular/core';
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

import { PlatformStripeTaxRateRecord } from '../../../shared/rpc-contracts/app-rpcs/platform-tenant-admin.rpcs';
import { NotificationService } from '../../core/notification.service';
import {
  PlatformTaxRatesComponent,
  PlatformTaxRatesOperations,
} from './platform-tax-rates.component';
import { PlatformTenantPageHeaderComponent } from './platform-tenant-page-header.component';

@Component({ selector: 'app-platform-tenant-page-header', template: '' })
class PlatformTenantPageHeaderStub {
  readonly tenantId = input.required<string>();
  readonly title = input.required<string>();
}

describe('PlatformTaxRatesComponent', () => {
  let queryClient: QueryClient;
  const listRates = vi.fn();
  const importRates = vi.fn();
  const showError = vi.fn();

  beforeEach(async () => {
    listRates.mockReset();
    importRates.mockReset();
    showError.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: 0, retry: false } },
    });
    TestBed.overrideComponent(PlatformTaxRatesComponent, {
      add: { imports: [PlatformTenantPageHeaderStub] },
      remove: { imports: [PlatformTenantPageHeaderComponent] },
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
            import: () => ({
              mutationFn: importRates,
              mutationKey: ['import-rates'],
            }),
            list: (tenantId: string) => ({
              queryFn: listRates,
              queryKey: ['rates', tenantId],
            }),
            taxRatesFilter: () => ({ queryKey: ['rates'] }),
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
      error: {
        _tag: 'RpcBadRequestError',
        message: 'Paid sign-ups are not ready for this organization.',
      },
      expected: 'Paid sign-ups are not ready for this organization.',
      label: 'missing account',
    },
    {
      error: {
        _tag: 'RpcInternalServerError',
        message: 'Private provider failure details',
      },
      expected: 'Tax rates could not be loaded. Try again.',
      label: 'provider failure',
    },
  ])(
    'shows accurate safe guidance for a $label and supports retry',
    async ({ error, expected }) => {
      listRates.mockRejectedValueOnce(error).mockResolvedValue([]);
      const fixture = TestBed.createComponent(PlatformTaxRatesComponent);
      fixture.componentRef.setInput('tenantId', 'tenant-1');
      const root: HTMLElement = fixture.nativeElement;
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(root.querySelector('[role="alert"]')?.textContent).toContain(
          expected,
        );
      });
      expect(root.textContent).not.toContain(
        'Private provider failure details',
      );
      expect(root.textContent).not.toContain(
        'organization needs an online payment account',
      );
      root
        .querySelector<HTMLButtonElement>(':scope [role="alert"] button')
        ?.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(listRates).toHaveBeenCalledTimes(2);
        expect(root.querySelector('[role="alert"]')).toBeNull();
      });
    },
  );

  it('keeps rates with a missing percentage unavailable and spells out country names', async () => {
    listRates.mockResolvedValue([
      new PlatformStripeTaxRateRecord({
        active: true,
        country: 'DE',
        displayName: 'VAT',
        id: 'txr_missing',
        imported: false,
        inclusive: true,
        percentage: null,
        state: null,
      }),
    ]);
    const fixture = TestBed.createComponent(PlatformTaxRatesComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    const root: HTMLElement = fixture.nativeElement;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.textContent).toContain('Germany');
    });
    expect(root.textContent).toContain('Country or region');
    root.querySelector<HTMLElement>('mat-select')?.click();
    fixture.detectChanges();
    const option = document.querySelector<HTMLElement>('mat-option');
    expect(option?.getAttribute('aria-disabled')).toBe('true');
    expect(option?.textContent).toContain('Percentage unavailable');
  });

  it.each([
    {
      error: new RpcBadRequestError({
        message:
          'One selected tax rate is no longer available. Choose another rate.',
      }),
      expected:
        'One selected tax rate is no longer available. Choose another rate.',
      label: 'expected import failure',
      phase: 'mutation',
    },
    {
      error: new RpcInternalServerError({
        message: 'Private provider failure details',
      }),
      expected:
        'The import outcome could not be confirmed. Load the page again to check the current tax rates before trying again.',
      label: 'provider failure',
      phase: 'mutation',
    },
    {
      error: new Error('Response connection closed'),
      expected:
        'The import outcome could not be confirmed. Load the page again to check the current tax rates before trying again.',
      label: 'lost import response',
      phase: 'mutation',
    },
    {
      error: new Error('Refresh failed after import completed'),
      expected:
        'Tax rates were imported, but the list could not be updated. Load the page again to see the current tax rates.',
      label: 'refresh failure after import succeeded',
      phase: 'refresh',
    },
  ])(
    'reports the $label without discarding the selected rate or reason',
    async ({ error, expected, phase }) => {
      listRates.mockResolvedValue([
        new PlatformStripeTaxRateRecord({
          active: true,
          country: 'DE',
          displayName: 'VAT',
          id: 'txr_vat',
          imported: false,
          inclusive: true,
          percentage: 19,
          state: null,
        }),
      ]);
      if (phase === 'refresh') {
        importRates.mockResolvedValue(undefined);
        vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(error);
      } else {
        importRates.mockRejectedValue(error);
      }
      const fixture = TestBed.createComponent(PlatformTaxRatesComponent);
      fixture.componentRef.setInput('tenantId', 'tenant-1');
      const root: HTMLElement = fixture.nativeElement;
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(root.querySelector('mat-select')).not.toBeNull();
      });
      root.querySelector<HTMLElement>('mat-select')?.click();
      fixture.detectChanges();
      document.querySelector<HTMLElement>('mat-option')?.click();
      fixture.detectChanges();
      const reason = root.querySelector<HTMLTextAreaElement>('textarea');
      if (!reason) throw new Error('Expected the import reason field.');
      reason.value = 'Enable registration tax';
      reason.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      root
        .querySelector<HTMLFormElement>('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(showError).toHaveBeenCalledWith(expected);
      });
      expect(importRates).toHaveBeenCalledOnce();
      expect(importRates.mock.calls[0]?.[0]).toEqual({
        ids: ['txr_vat'],
        reason: 'Enable registration tax',
        targetTenantId: 'tenant-1',
      });
      expect(reason.value).toBe('Enable registration tax');
      expect(root.querySelector('mat-select')?.textContent).toContain('VAT');
      expect(
        root.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(false);
    },
  );
});

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
      expected:
        'The import outcome could not be confirmed. Load the page again to check the current tax rates before trying again.',
    },
    {
      error: new RpcForbiddenError({
        message: 'private authorization details',
      }),
      expected:
        'The import outcome could not be confirmed. Load the page again to check the current tax rates before trying again.',
    },
    {
      error: new Error('private transport details'),
      expected:
        'The import outcome could not be confirmed. Load the page again to check the current tax rates before trying again.',
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
      expect(importRates).toHaveBeenCalledExactlyOnceWith(
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
