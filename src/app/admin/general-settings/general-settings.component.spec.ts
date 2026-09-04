import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import { AdminTenantNotFoundError } from '@shared/rpc-contracts/app-rpcs/admin.errors';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import {
  createGeneralSettingsFormModel,
  generalSettingsBrandAssetUploadDisabled,
  GeneralSettingsComponent,
  generalSettingsFormSchema,
  generalSettingsSaveDisabled,
  generalSettingsUpdateErrorMessage,
  tenantTimezoneValidationError,
} from './general-settings.component';

beforeEach(() => {
  TestBed.configureTestingModule({});
});

describe('generalSettingsSaveDisabled', () => {
  it('blocks tenant settings saves while invalid, submitting, or mutation-pending', () => {
    expect(
      generalSettingsSaveDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      generalSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      generalSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      generalSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});

describe('generalSettingsBrandAssetUploadDisabled', () => {
  it('blocks brand asset uploads while any upload is active or mutation-pending', () => {
    expect(
      generalSettingsBrandAssetUploadDisabled({
        mutationPending: false,
        uploadingBrandAsset: 'logo',
      }),
    ).toBe(true);
    expect(
      generalSettingsBrandAssetUploadDisabled({
        mutationPending: true,
        uploadingBrandAsset: null,
      }),
    ).toBe(true);
    expect(
      generalSettingsBrandAssetUploadDisabled({
        mutationPending: false,
        uploadingBrandAsset: null,
      }),
    ).toBe(false);
  });
});

describe('tenantTimezoneValidationError', () => {
  it('accepts city or region timezones and rejects browser-local abbreviations', () => {
    expect(tenantTimezoneValidationError('America/New_York')).toBeUndefined();
    expect(tenantTimezoneValidationError('PST')).toEqual({
      kind: 'ianaTimezone',
      message: 'Enter a recognized city or region timezone.',
    });
  });
});

describe('tenant policy deadline validation', () => {
  it('requires both deadline values before settings can be saved', () => {
    const model = createGeneralSettingsFormModel();
    Reflect.set(model, 'cancellationDeadlineHoursBeforeStart', null);
    Reflect.set(model, 'transferDeadlineHoursBeforeStart', null);
    const settings = form(signal(model), generalSettingsFormSchema, {
      injector: TestBed.inject(Injector),
    });

    expect(
      settings
        .cancellationDeadlineHoursBeforeStart()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter a cancellation deadline.');
    expect(
      settings
        .transferDeadlineHoursBeforeStart()
        .errors()
        .map((error) => error.message),
    ).toContain('Enter a transfer deadline.');
  });
});

describe('general settings error notifications', () => {
  const save = vi.fn();
  const upload = vi.fn();
  const showError = vi.fn();
  let queryClient: QueryClient;

  beforeEach(async () => {
    save.mockReset();
    upload.mockReset();
    showError.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    TestBed.overrideComponent(GeneralSettingsComponent, {
      set: {
        template:
          '<input type="file" (change)="uploadBrandAsset(\'logo\', $event)" />',
      },
    });
    await TestBed.configureTestingModule({
      imports: [GeneralSettingsComponent],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: ConfigService,
          useValue: {
            tenant: {
              ...createGeneralSettingsFormModel(),
              receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
            },
            tenantSignal: signal(null),
          },
        },
        {
          provide: NotificationService,
          useValue: { showError, showSuccess: vi.fn() },
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            admin: {
              tenant: {
                updateSettings: {
                  mutationOptions: () => ({ mutationFn: save }),
                },
                uploadBrandAsset: {
                  mutationOptions: () => ({ mutationFn: upload }),
                },
              },
            },
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
    new RpcBadRequestError({
      message: 'Tenant currency and timezone settings are locked',
    }),
    new AdminTenantNotFoundError({ message: 'Tenant not found or stale' }),
  ])('preserves expected settings guidance: $message', async (error) => {
    save.mockRejectedValueOnce(error);
    const fixture = TestBed.createComponent(GeneralSettingsComponent);
    fixture.detectChanges();
    await fixture.componentInstance.saveSettings(new Event('submit'));
    expect(save).toHaveBeenCalledOnce();
    expect(showError).toHaveBeenCalledExactlyOnceWith(error.message);
  });

  it.each([
    new RpcInternalServerError({ message: 'private provider details' }),
    new RpcForbiddenError({ message: 'private authorization details' }),
    new Error('private browser details'),
  ])('keeps unsafe settings failures generic: %s', async (error) => {
    save.mockRejectedValueOnce(error);
    const fixture = TestBed.createComponent(GeneralSettingsComponent);
    fixture.detectChanges();
    await fixture.componentInstance.saveSettings(new Event('submit'));
    expect(showError).toHaveBeenCalledExactlyOnceWith(
      'Failed to update organization settings',
    );
  });

  it.each([
    {
      error: new RpcBadRequestError({
        message: 'Uploaded file size does not match payload metadata',
      }),
      expected: 'Uploaded file size does not match payload metadata',
    },
    {
      error: new RpcInternalServerError({ message: 'private storage details' }),
      expected: 'Failed to upload brand asset',
    },
  ])(
    'reports only safe upload guidance: $expected',
    async ({ error, expected }) => {
      upload.mockRejectedValueOnce(error);
      const fixture = TestBed.createComponent(GeneralSettingsComponent);
      fixture.detectChanges();
      const input: HTMLInputElement | null =
        fixture.nativeElement.querySelector('input');
      if (!input) throw new Error('Upload input not rendered');
      Object.defineProperty(input, 'files', {
        value: [new File(['image'], 'logo.png', { type: 'image/png' })],
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() =>
        expect(showError).toHaveBeenCalledExactlyOnceWith(expected),
      );
      expect(upload).toHaveBeenCalledOnce();
    },
  );
});

describe('complete organization settings validation', () => {
  it('rejects invalid policy counts and incomplete receipt country choices', () => {
    const model = signal(createGeneralSettingsFormModel());
    const settings = form(model, generalSettingsFormSchema, {
      injector: TestBed.inject(Injector),
    });
    for (const field of [
      'cancellationDeadlineHoursBeforeStart',
      'maxActiveRegistrationsPerUser',
      'transferDeadlineHoursBeforeStart',
    ] as const) {
      for (const value of [-1, 1.5, 2_147_483_648]) {
        model.set({ ...createGeneralSettingsFormModel(), [field]: value });
        expect(settings[field]().invalid()).toBe(true);
      }
    }
    for (const receiptCountries of [[], ['DE', 'DE'], ['invalid']]) {
      model.set({ ...createGeneralSettingsFormModel(), receiptCountries });
      expect(settings.receiptCountries().invalid()).toBe(true);
    }
    model.set({
      ...createGeneralSettingsFormModel(),
      receiptCountries: ['DE', 'NL'],
      theme: 'classic',
    });
    expect(settings().valid()).toBe(true);
  });
});

describe('organization settings expected outcomes', () => {
  it('shows a safe rejected-save message while keeping unexpected details private', () => {
    const message =
      'Currency cannot be changed after financial information has been added.';
    expect(
      generalSettingsUpdateErrorMessage({
        _tag: 'RpcBadRequestError',
        message,
        reason:
          'This organization already has templates, events, receipts, or payments.',
      }),
    ).toBe(message);
    expect(
      generalSettingsUpdateErrorMessage(new Error('private database details')),
    ).toBe('Failed to update organization settings');
    expect(
      generalSettingsUpdateErrorMessage({
        _tag: 'RpcInternalError',
        message: 'private database details',
      }),
    ).toBe('Failed to update organization settings');
  });
});
