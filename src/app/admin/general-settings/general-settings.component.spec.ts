import { DOCUMENT, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { provideRouter } from '@angular/router';
import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import { AdminTenantNotFoundError } from '@shared/rpc-contracts/app-rpcs/admin.errors';
import {
  adminTenantSettingsSnapshot,
  tenantSettingsConflict,
} from '@shared/tenant-settings-snapshot';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Tenant } from '../../../types/custom/tenant';
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
  const tenantSignal = signal<null | Tenant>(null);
  let initialTenant: Tenant;
  let queryClient: QueryClient;

  beforeEach(async () => {
    save.mockReset();
    upload.mockReset();
    showError.mockReset();
    initialTenant = new Tenant({
      cancellationDeadlineHoursBeforeStart: 120,
      currency: 'EUR',
      defaultLocation: undefined,
      discountProviders: { esnCard: { config: {}, status: 'disabled' } },
      domain: 'tenant.example.test',
      emailSenderName: 'Original name',
      id: 'tenant-1',
      maxActiveRegistrationsPerUser: 0,
      name: 'Tenant',
      receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
      refundFeesOnCancellation: true,
      theme: 'evorto',
      timezone: 'Europe/Berlin',
      transferDeadlineHoursBeforeStart: 0,
    });
    tenantSignal.set(null);
    queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    await TestBed.configureTestingModule({
      imports: [GeneralSettingsComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: ConfigService,
          useValue: {
            tenant: initialTenant,
            tenantSignal,
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
            pathKey: () => ['config', 'tenant'],
            queryFilter: () => ({
              queryKey: ['discounts', 'getTenantProviders'],
            }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
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

  it('retains edits and their original snapshot after refetch, blocks conflict resubmission, and reloads explicitly', async () => {
    save.mockRejectedValueOnce(tenantSettingsConflict());
    const fixture = TestBed.createComponent(GeneralSettingsComponent);
    fixture.detectChanges();
    const input: HTMLInputElement | null = fixture.nativeElement.querySelector(
      'input[placeholder="Example Section"]',
    );
    if (!input) throw new Error('Reply-to name input not rendered');
    input.value = 'Unsaved name';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const latest = new Tenant({
      ...initialTenant,
      emailSenderName: 'Changed elsewhere',
    });
    tenantSignal.set(latest);
    fixture.detectChanges();
    expect(input.value).toBe('Unsaved name');

    await fixture.componentInstance.saveSettings(new Event('submit'));
    fixture.detectChanges();
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      emailSenderName: 'Unsaved name',
      expectedSettings: adminTenantSettingsSnapshot(initialTenant),
    });
    expect(input.value).toBe('Unsaved name');
    expect(showError).toHaveBeenCalledExactlyOnceWith(
      tenantSettingsConflict().message,
    );
    const saveButton: HTMLButtonElement | null =
      fixture.nativeElement.querySelector('button[type="submit"]');
    expect(saveButton?.disabled).toBe(true);
    await fixture.componentInstance.saveSettings(new Event('submit'));
    expect(save).toHaveBeenCalledOnce();
    const location = TestBed.inject(DOCUMENT).defaultView?.location;
    if (!location) throw new Error('Browser document location unavailable');
    const reload = vi.spyOn(location, 'reload').mockImplementation(vi.fn());
    const reloadButton: HTMLButtonElement | null =
      fixture.nativeElement.querySelector(':scope [role="alert"] button');
    if (!reloadButton) throw new Error('Conflict reload action not rendered');
    reloadButton.click();
    expect(reload).toHaveBeenCalledOnce();
    fixture.destroy();

    save.mockResolvedValueOnce(latest);
    const reloaded = TestBed.createComponent(GeneralSettingsComponent);
    reloaded.detectChanges();
    const reloadedInput: HTMLInputElement | null =
      reloaded.nativeElement.querySelector(
        'input[placeholder="Example Section"]',
      );
    expect(reloadedInput?.value).toBe('Changed elsewhere');
    await reloaded.componentInstance.saveSettings(new Event('submit'));
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      emailSenderName: 'Changed elsewhere',
      expectedSettings: adminTenantSettingsSnapshot(latest),
    });
  });

  it('advances the saved snapshot without overwriting edits made during the request', async () => {
    const updateResponse = new Subject<Tenant>();
    save.mockReturnValueOnce(firstValueFrom(updateResponse));
    const fixture = TestBed.createComponent(GeneralSettingsComponent);
    fixture.detectChanges();
    const input: HTMLInputElement | null = fixture.nativeElement.querySelector(
      'input[placeholder="Example Section"]',
    );
    if (!input) throw new Error('Reply-to name input not rendered');
    input.value = 'First edit';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const pendingSave = fixture.componentInstance.saveSettings(
      new Event('submit'),
    );
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    input.value = 'Newer edit';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const saved = new Tenant({
      ...initialTenant,
      emailSenderName: 'First edit',
    });
    tenantSignal.set(saved);
    fixture.detectChanges();
    const saveButton: HTMLButtonElement | null =
      fixture.nativeElement.querySelector('button[type="submit"]');
    if (!saveButton) throw new Error('Settings save action not rendered');
    expect(saveButton.disabled).toBe(true);
    updateResponse.next(saved);
    updateResponse.complete();
    await pendingSave;
    await fixture.whenStable();
    fixture.detectChanges();
    expect(input.value).toBe('Newer edit');
    expect(saveButton.disabled).toBe(false);

    save.mockResolvedValueOnce(
      new Tenant({ ...saved, emailSenderName: 'Newer edit' }),
    );
    await fixture.componentInstance.saveSettings(new Event('submit'));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      emailSenderName: 'Newer edit',
      expectedSettings: adminTenantSettingsSnapshot(saved),
    });
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
        fixture.nativeElement.querySelector('input[type="file"]');
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
