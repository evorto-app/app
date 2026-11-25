import type { AdminTenantUpdatePaymentProviderSettingsInput } from '@shared/rpc-contracts/app-rpcs/admin.rpcs';

import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import {
  createRpcMutationOptions,
  createRpcQueryFilter,
} from '@heddendorp/effect-angular-query';
import { ClientTenantConfig } from '@shared/rpc-contracts/app-rpcs/config.rpcs';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import {
  PaymentProviderSettingsComponent,
  paymentProviderSettingsFormSchema,
} from './payment-provider-settings.component';

beforeEach(() => {
  TestBed.configureTestingModule({});
});

describe('paymentProviderSettingsFormSchema', () => {
  it('requires at least one receipt country', () => {
    const settings = form(
      signal({
        allowOther: false,
        allowReceiptSelfApproval: false,
        buyEsnCardUrl: '',
        currency: 'EUR' as const,
        esnCardEnabled: false,
        receiptCountries: [],
        refundFeesOnCancellation: true,
      }),
      paymentProviderSettingsFormSchema,
      {
        injector: TestBed.inject(Injector),
      },
    );

    expect(
      settings
        .receiptCountries()
        .errors()
        .map((error) => error.message),
    ).toContain('Choose at least one receipt country.');
  });
});

describe('preserved receipt country validation', () => {
  it('rejects incomplete, duplicate and unsupported choices without normalizing them', () => {
    const initial = {
      allowOther: false,
      allowReceiptSelfApproval: false,
      buyEsnCardUrl: '',
      currency: 'EUR' as const,
      esnCardEnabled: false,
      receiptCountries: ['DE', 'NL'],
      refundFeesOnCancellation: true,
    };
    const model = signal(initial);
    const settings = form(model, paymentProviderSettingsFormSchema, {
      injector: TestBed.inject(Injector),
    });
    for (const receiptCountries of [
      [],
      ['DE', 'DE'],
      ['de'],
      ['invalid'],
      ['OTHER'],
    ]) {
      model.set({ ...initial, receiptCountries });
      expect(settings.receiptCountries().invalid()).toBe(true);
      expect(settings.receiptCountries().value()).toEqual(receiptCountries);
    }
    model.set(initial);
    expect(settings().valid()).toBe(true);
  });
});

describe('receipt self-approval setting', () => {
  const update =
    vi.fn<
      (input: AdminTenantUpdatePaymentProviderSettingsInput) => Promise<void>
    >();
  const makeTenant = (allowSelfApproval: boolean | undefined) =>
    new ClientTenantConfig({
      cancellationDeadlineHoursBeforeStart: 24,
      currency: 'EUR',
      defaultLocation: undefined,
      discountProviders: { esnCard: { config: {}, status: 'disabled' } },
      domain: 'tenant.example.test',
      id: 'tenant-1',
      maxActiveRegistrationsPerUser: 3,
      name: 'Tenant',
      paymentsConfigured: true,
      receiptSettings: {
        allowOther: false,
        ...(allowSelfApproval !== undefined && { allowSelfApproval }),
        receiptCountries: ['DE'],
      },
      refundFeesOnCancellation: false,
      theme: 'evorto',
      timezone: 'Europe/Berlin',
      transferDeadlineHoursBeforeStart: 24,
    });
  let queryClient: QueryClient;

  const render = async (allowSelfApproval: boolean | undefined) => {
    update.mockReset().mockResolvedValue();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    await TestBed.configureTestingModule({
      imports: [PaymentProviderSettingsComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTanStackQuery(queryClient),
        {
          provide: ConfigService,
          useValue: {
            tenantSignal: signal<ClientTenantConfig | null>(
              makeTenant(allowSelfApproval),
            ),
          },
        },
        {
          provide: NotificationService,
          useValue: { showError: vi.fn(), showSuccess: vi.fn() },
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            admin: {
              tenant: {
                updatePaymentProviderSettings: {
                  mutationOptions: () =>
                    createRpcMutationOptions({
                      keyPrefix: 'rpc',
                      mutationFn: update,
                      pathSegments: [
                        'admin',
                        'tenant',
                        'updatePaymentProviderSettings',
                      ],
                    }),
                },
              },
            },
            queryFilter: (path: readonly string[]) =>
              createRpcQueryFilter(path, { keyPrefix: 'rpc' }),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentProviderSettingsComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };
  const toggle = (root: HTMLElement) => {
    const element = [...root.querySelectorAll('mat-slide-toggle')].find(
      (candidate) =>
        candidate.textContent?.includes(
          'Allow approvers to approve their own receipts',
        ),
    );
    const input = element?.querySelector('button[role="switch"], input');
    if (!input) throw new Error('Missing self-approval toggle');
    return input;
  };

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  it.each([
    { expected: false, tenantValue: undefined },
    { expected: false, tenantValue: false },
    { expected: true, tenantValue: true },
  ])(
    'loads $tenantValue as $expected and sends it on save',
    async ({ expected, tenantValue }) => {
      const fixture = await render(tenantValue);
      const root: unknown = fixture.nativeElement;
      if (!(root instanceof HTMLElement)) throw new Error('Missing root');
      const input = toggle(root);
      expect(
        input.getAttribute('aria-checked') ??
          String(input.hasAttribute('checked')),
      ).toBe(String(expected));
      const form = root.querySelector('form');
      await vi.waitFor(() => {
        const submit = root.querySelector<HTMLButtonElement>(
          'button[type="submit"]',
        );
        fixture.detectChanges();
        expect(submit?.disabled).toBe(false);
      });
      form?.dispatchEvent(new Event('submit', { cancelable: true }));
      await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
      expect(update.mock.calls[0]?.[0].allowReceiptSelfApproval).toBe(expected);
    },
  );
});
