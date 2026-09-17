import { DOCUMENT } from '@angular/common';
import { signal, type Type } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  createRpcMutationOptions,
  createRpcQueryFilter,
  createRpcQueryKey,
} from '@heddendorp/effect-angular-query';
import {
  adminTenantAppearanceSettingsSnapshot,
  adminTenantLegalSettingsSnapshot,
  adminTenantOrganizationSettingsSnapshot,
  adminTenantPaymentProviderSettingsSnapshot,
  adminTenantRegistrationSettingsSnapshot,
  tenantSettingsConflict,
} from '@shared/tenant-settings-snapshot';
import {
  type MutationFunctionContext,
  onlineManager,
  provideTanStackQuery,
  QueryClient,
  type QueryFilters,
  type QueryKey,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { describe, expect, it, type MockInstance, vi } from 'vitest';

import type { DiscountProviderRecord } from '../../../shared/rpc-contracts/app-rpcs/discounts.rpcs';

import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '../../../shared/errors/rpc-errors';
import { AdminTenantNotFoundError } from '../../../shared/rpc-contracts/app-rpcs/admin.errors';
import { ClientTenantConfig } from '../../../shared/rpc-contracts/app-rpcs/config.rpcs';
import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import { AppearanceSettingsComponent } from './appearance-settings.component';
import { LegalSettingsComponent } from './legal-settings.component';
import { OrganizationSettingsComponent } from './organization-settings.component';
import { PaymentProviderSettingsComponent } from './payment-provider-settings.component';
import { RegistrationSettingsComponent } from './registration-settings.component';
import {
  optionalTrimmed,
  tenantSettingsCanDeactivate,
  tenantSettingsSaveDisabled,
  tenantSettingsShouldHydrate,
} from './settings-form';

describe('tenantSettingsSaveDisabled', () => {
  it('blocks saves before hydration or while a form is invalid, submitting, or mutation-pending', () => {
    expect(
      tenantSettingsSaveDisabled({
        formInvalid: true,
        formSubmitting: false,
        interactionReady: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      tenantSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: true,
        interactionReady: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      tenantSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        interactionReady: true,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      tenantSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        interactionReady: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      tenantSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        interactionReady: true,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});

describe('optionalTrimmed', () => {
  it('trims non-empty values and maps blank values to undefined', () => {
    expect(optionalTrimmed(' value ')).toBe('value');
    expect(optionalTrimmed(' '.repeat(3))).toBeUndefined();
  });
});

describe('tenant settings dirty-state protection', () => {
  it('hydrates pristine models without replacing dirty edits', () => {
    expect(tenantSettingsShouldHydrate(false)).toBe(true);
    expect(tenantSettingsShouldHydrate(true)).toBe(false);
  });

  it('requires explicit confirmation before discarding dirty settings', () => {
    const confirmDiscard = vi.fn(() => false);
    const dirtyComponent = {
      hasUnsavedSettingsChanges: () => true,
    };

    expect(tenantSettingsCanDeactivate(dirtyComponent, confirmDiscard)).toBe(
      false,
    );
    expect(confirmDiscard).toHaveBeenCalledWith(
      'You have unsaved settings changes. Leave this page and discard them?',
    );

    confirmDiscard.mockReturnValue(true);
    expect(tenantSettingsCanDeactivate(dirtyComponent, confirmDiscard)).toBe(
      true,
    );
    expect(
      tenantSettingsCanDeactivate(
        { hasUnsavedSettingsChanges: () => false },
        confirmDiscard,
      ),
    ).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledTimes(2);
  });

  it('fails closed when confirmation is unavailable for dirty settings', () => {
    expect(
      tenantSettingsCanDeactivate(
        { hasUnsavedSettingsChanges: () => true },
        undefined,
      ),
    ).toBe(false);
  });
});

type FocusedSettingsComponent =
  | AppearanceSettingsComponent
  | LegalSettingsComponent
  | OrganizationSettingsComponent
  | PaymentProviderSettingsComponent
  | RegistrationSettingsComponent;

// Narrow each concrete component so protected test access remains typed.
const settingsControls = (component: FocusedSettingsComponent) => {
  if (component instanceof AppearanceSettingsComponent) {
    return {
      save: component['save'].bind(component),
      saveOutcome: component['saveOutcome'],
      settingsForm: component['settingsForm'],
      settingsInteractionReady: component['settingsInteractionReady'],
      settingsLocked: component['settingsLocked'],
      settingsPhase: component['settingsPhase'],
    };
  }
  if (component instanceof LegalSettingsComponent) {
    return {
      save: component['save'].bind(component),
      saveOutcome: component['saveOutcome'],
      settingsForm: component['settingsForm'],
      settingsInteractionReady: component['settingsInteractionReady'],
      settingsLocked: component['settingsLocked'],
      settingsPhase: component['settingsPhase'],
    };
  }
  if (component instanceof OrganizationSettingsComponent) {
    return {
      save: component['save'].bind(component),
      saveOutcome: component['saveOutcome'],
      settingsForm: component['settingsForm'],
      settingsInteractionReady: component['settingsInteractionReady'],
      settingsLocked: component['settingsLocked'],
      settingsPhase: component['settingsPhase'],
    };
  }
  if (component instanceof PaymentProviderSettingsComponent) {
    return {
      save: component['save'].bind(component),
      saveOutcome: component['saveOutcome'],
      settingsForm: component['settingsForm'],
      settingsInteractionReady: component['settingsInteractionReady'],
      settingsLocked: component['settingsLocked'],
      settingsPhase: component['settingsPhase'],
    };
  }
  if (component instanceof RegistrationSettingsComponent) {
    return {
      save: component['save'].bind(component),
      saveOutcome: component['saveOutcome'],
      settingsForm: component['settingsForm'],
      settingsInteractionReady: component['settingsInteractionReady'],
      settingsLocked: component['settingsLocked'],
      settingsPhase: component['settingsPhase'],
    };
  }
  throw new Error('Unexpected focused settings component');
};

const settingsTenant = new ClientTenantConfig({
  cancellationDeadlineHoursBeforeStart: 24,
  currency: 'EUR',
  defaultLocation: undefined,
  discountProviders: {
    esnCard: {
      config: { buyEsnCardUrl: 'https://esncard.org/' },
      status: 'enabled',
    },
  },
  domain: 'settings.example.test',
  emailSenderName: 'Existing sender',
  id: 'settings-tenant',
  legalNoticeText: 'Existing legal notice',
  maxActiveRegistrationsPerUser: 3,
  name: 'Settings section',
  paymentsConfigured: true,
  receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
  refundFeesOnCancellation: false,
  seoTitle: 'Existing search title',
  theme: 'evorto',
  timezone: 'Europe/Berlin',
  transferDeadlineHoursBeforeStart: 24,
});

const settingsCases: readonly {
  component: Type<FocusedSettingsComponent>;
  fieldLabel: string;
  input: string;
  name: string;
  payload: object;
  procedure: string;
  saved: Partial<ClientTenantConfig>;
  snapshot: (tenant: ClientTenantConfig) => object;
  success: string;
}[] = [
  {
    component: OrganizationSettingsComponent,
    fieldLabel: 'Reply name',
    input: ' New sender ',
    name: 'organization',
    payload: {
      defaultLocation: null,
      emailSenderEmail: undefined,
      emailSenderName: 'New sender',
      timezone: 'Europe/Berlin',
    },
    procedure: 'updateOrganizationSettings',
    saved: { emailSenderName: 'New sender' },
    snapshot: adminTenantOrganizationSettingsSnapshot,
    success: 'Organization settings updated',
  },
  {
    component: RegistrationSettingsComponent,
    fieldLabel: 'Active sign-up limit',
    input: '7',
    name: 'registration',
    payload: {
      cancellationDeadlineHoursBeforeStart: 24,
      maxActiveRegistrationsPerUser: 7,
      transferDeadlineHoursBeforeStart: 24,
    },
    procedure: 'updateRegistrationSettings',
    saved: { maxActiveRegistrationsPerUser: 7 },
    snapshot: adminTenantRegistrationSettingsSnapshot,
    success: 'Sign-up rules updated',
  },
  {
    component: PaymentProviderSettingsComponent,
    fieldLabel: 'ESNcard purchase web address',
    input: ' https://cards.example.test/buy ',
    name: 'payment',
    payload: {
      allowOther: false,
      buyEsnCardUrl: 'https://cards.example.test/buy',
      currency: 'EUR',
      esnCardEnabled: true,
      receiptCountries: ['DE'],
      refundFeesOnCancellation: false,
    },
    procedure: 'updatePaymentProviderSettings',
    saved: {
      discountProviders: {
        esnCard: {
          config: { buyEsnCardUrl: 'https://cards.example.test/buy' },
          status: 'enabled',
        },
      },
    },
    snapshot: adminTenantPaymentProviderSettingsSnapshot,
    success: 'Payment settings updated',
  },
  {
    component: AppearanceSettingsComponent,
    fieldLabel: 'Search result title',
    input: ' New search title ',
    name: 'appearance',
    payload: {
      faviconUrl: undefined,
      logoUrl: undefined,
      seoDescription: undefined,
      seoTitle: 'New search title',
      theme: 'evorto',
    },
    procedure: 'updateAppearanceSettings',
    saved: { seoTitle: 'New search title' },
    snapshot: adminTenantAppearanceSettingsSnapshot,
    success: 'Appearance settings updated',
  },
  {
    component: LegalSettingsComponent,
    fieldLabel: 'Imprint / legal notice text published by Evorto',
    input: ' New legal notice ',
    name: 'legal',
    payload: {
      legalNoticeText: 'New legal notice',
      legalNoticeUrl: undefined,
      termsText: undefined,
      termsUrl: undefined,
    },
    procedure: 'updateLegalSettings',
    saved: { legalNoticeText: 'New legal notice' },
    snapshot: adminTenantLegalSettingsSnapshot,
    success: 'Legal settings updated',
  },
];

const settingsConfigKey = createRpcQueryKey(['config', 'tenant'], {
  keyPrefix: 'rpc',
  type: 'query',
});
const settingsConfigFilter = createRpcQueryFilter(['config', 'tenant'], {
  keyPrefix: 'rpc',
});
const settingsProviders: readonly DiscountProviderRecord[] = [
  {
    config: { buyEsnCardUrl: 'https://cards.example.test/buy' },
    status: 'enabled',
    type: 'esnCard',
  },
];
const settingsProviderKey = createRpcQueryKey(
  ['discounts', 'getTenantProviders'],
  { keyPrefix: 'rpc', type: 'query' },
);

const settingsElement = (
  fixture: ComponentFixture<FocusedSettingsComponent>,
): HTMLElement => {
  const element: unknown = fixture.nativeElement;
  if (!(element instanceof HTMLElement))
    throw new Error('Expected settings page element');
  return element;
};

const settingsInput = (
  root: HTMLElement,
  label: string,
): HTMLInputElement | HTMLTextAreaElement => {
  const field = [...root.querySelectorAll('mat-form-field')].find(
    (element) =>
      element.querySelector('mat-label')?.textContent?.trim() === label,
  );
  const input = field?.querySelector('input, textarea');
  if (
    !(input instanceof HTMLInputElement) &&
    !(input instanceof HTMLTextAreaElement)
  ) {
    throw new TypeError(`Expected settings field: ${label}`);
  }
  return input;
};

const withSettingsFixture = async (
  entry: (typeof settingsCases)[number],
  check: (context: {
    configSignal: ReturnType<typeof signal<ClientTenantConfig | null>>;
    defer: <T>(fallback: T) => {
      promise: Promise<T>;
      resolve: (value: T) => void;
    };
    fixture: ComponentFixture<FocusedSettingsComponent>;
    input: HTMLInputElement | HTMLTextAreaElement;
    observe: <T extends object>(
      key: QueryKey,
      queryFn: () => Promise<T>,
      initialData: T,
      enabled?: boolean,
      staleTime?: 'static' | number,
    ) => void;
    queryClient: QueryClient;
    readConfig: ReturnType<typeof vi.fn<() => Promise<ClientTenantConfig>>>;
    reload: MockInstance<() => void>;
    root: HTMLElement;
    savedTenant: ClientTenantConfig;
    saveMutation: ReturnType<
      typeof vi.fn<
        (input: unknown, context: MutationFunctionContext) => Promise<void>
      >
    >;
    showError: ReturnType<typeof vi.fn>;
    showSuccess: ReturnType<typeof vi.fn>;
    stopConfig: () => void;
    track: <T>(promise: Promise<T>) => Promise<T>;
  }) => Promise<void>,
): Promise<void> => {
  const releases: (() => void)[] = [];
  const drains: (() => Promise<unknown>)[] = [];
  const unsubscribers: (() => void)[] = [];
  const failures: unknown[] = [];
  let acquiredQueryClient: QueryClient | undefined;
  const originallyOnline = onlineManager.isOnline();
  const track = <T>(promise: Promise<T>): Promise<T> => {
    const settled = promise.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ reason: error, status: 'rejected' as const }),
    );
    drains.push(async () => {
      const result = await settled;
      if (result.status === 'rejected') throw result.reason;
    });
    return promise;
  };
  const defer = <T>(fallback: T) => {
    let resolver: ((value: T) => void) | undefined;
    // Angular's browser target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const promise = new Promise<T>((resolve) => {
      resolver = resolve;
    });
    const resolve = (value: T) => {
      if (!resolver)
        throw new Error('Deferred settings read was not initialized');
      resolver(value);
    };
    releases.push(() => resolve(fallback));
    return { promise, resolve };
  };
  try {
    onlineManager.setOnline(true);
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    acquiredQueryClient = queryClient;
    const savedTenant = new ClientTenantConfig({
      ...settingsTenant,
      ...entry.saved,
    });
    const configSignal = signal<ClientTenantConfig | null>(settingsTenant);
    const readConfig = vi
      .fn<() => Promise<ClientTenantConfig>>()
      .mockResolvedValue(savedTenant);
    const saveMutation = vi
      .fn<(input: unknown, context: MutationFunctionContext) => Promise<void>>()
      .mockResolvedValue(undefined);
    const uploadMutation = vi.fn();
    const showSuccess = vi.fn();
    const showError = vi.fn();
    const configObserver = new QueryObserver(queryClient, {
      initialData: settingsTenant,
      queryFn: readConfig,
      queryKey: settingsConfigKey,
      staleTime: Infinity,
    });
    const stopConfig = configObserver.subscribe((result) => {
      if (result.status === 'success') configSignal.set(result.data);
    });
    unsubscribers.push(stopConfig);
    const observe = <T extends object>(
      queryKey: QueryKey,
      queryFn: () => Promise<T>,
      initialData: T,
      enabled = true,
      staleTime: 'static' | number = Infinity,
    ) => {
      const observer = new QueryObserver(queryClient, {
        enabled,
        initialData,
        queryFn,
        queryKey,
        staleTime,
      });
      unsubscribers.push(
        observer.subscribe(() => {
          // Keep this real observer active while the save owns its read.
        }),
      );
    };
    const mutationOptions = (procedure: string) =>
      createRpcMutationOptions({
        keyPrefix: 'rpc',
        mutationFn: saveMutation,
        pathSegments: ['admin', 'tenant', procedure],
      });
    await TestBed.configureTestingModule({
      imports: [entry.component],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: ConfigService,
          useValue: { tenantSignal: configSignal } satisfies Pick<
            ConfigService,
            'tenantSignal'
          >,
        },
        { provide: NotificationService, useValue: { showError, showSuccess } },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            admin: {
              tenant: {
                updateAppearanceSettings: {
                  mutationOptions: () =>
                    mutationOptions('updateAppearanceSettings'),
                },
                updateLegalSettings: {
                  mutationOptions: () => mutationOptions('updateLegalSettings'),
                },
                updateOrganizationSettings: {
                  mutationOptions: () =>
                    mutationOptions('updateOrganizationSettings'),
                },
                updatePaymentProviderSettings: {
                  mutationOptions: () =>
                    mutationOptions('updatePaymentProviderSettings'),
                },
                updateRegistrationSettings: {
                  mutationOptions: () =>
                    mutationOptions('updateRegistrationSettings'),
                },
                uploadBrandAsset: {
                  mutationOptions: () => ({ mutationFn: uploadMutation }),
                },
              },
            },
            queryFilter: (path: readonly string[]): QueryFilters =>
              createRpcQueryFilter(path, { keyPrefix: 'rpc' }),
          },
        },
      ],
    }).compileComponents();
    const view = TestBed.inject(DOCUMENT).defaultView;
    if (!view) throw new Error('Settings test needs a document window');
    const reload = vi.spyOn(view.location, 'reload').mockImplementation(() => {
      // Observe the explicit reload without navigating the test document.
    });
    const fixture = TestBed.createComponent(entry.component);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = settingsElement(fixture);
    const input = settingsInput(root, entry.fieldLabel);
    await vi.waitFor(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      expect(
        settingsControls(fixture.componentInstance).settingsInteractionReady(),
      ).toBe(true);
    });
    input.value = entry.input;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(true);
    expect(
      settingsControls(fixture.componentInstance).settingsForm().invalid(),
    ).toBe(false);
    await check({
      configSignal,
      defer,
      fixture,
      input,
      observe,
      queryClient,
      readConfig,
      reload,
      root,
      savedTenant,
      saveMutation,
      showError,
      showSuccess,
      stopConfig,
      track,
    });
  } catch (error) {
    failures.push(error);
  }
  const cleanup: readonly ((() => Promise<unknown>) | (() => void))[] = [
    ...releases,
    ...drains,
    async () => {
      await acquiredQueryClient?.cancelQueries();
    },
    ...unsubscribers,
    () => acquiredQueryClient?.clear(),
    () => onlineManager.setOnline(originallyOnline),
    () => vi.restoreAllMocks(),
    () => TestBed.resetTestingModule(),
  ];
  for (const release of cleanup) {
    try {
      await release();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      'Settings assertions and fixture cleanup failed',
    );
};

describe('focused settings save outcomes', () => {
  for (const entry of settingsCases) {
    it(`${entry.name}: retains the original snapshot through a dirty refetch and requires explicit reload after a stale save`, async () => {
      await withSettingsFixture(
        entry,
        async ({
          fixture,
          input,
          queryClient,
          readConfig,
          reload,
          root,
          savedTenant,
          saveMutation,
          showError,
          showSuccess,
          track,
        }) => {
          await queryClient.refetchQueries(settingsConfigFilter, {
            throwOnError: true,
          });
          await fixture.whenStable();
          fixture.detectChanges();
          expect(queryClient.getQueryData(settingsConfigKey)).toEqual(
            savedTenant,
          );
          expect(input.value).toBe(entry.input);
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            true,
          );
          saveMutation.mockRejectedValueOnce(tenantSettingsConflict());

          await track(
            settingsControls(fixture.componentInstance).save(
              new Event('submit'),
            ),
          );
          fixture.detectChanges();
          expect(saveMutation).toHaveBeenCalledTimes(1);
          expect(saveMutation.mock.calls[0]?.[0]).toEqual({
            ...entry.payload,
            expectedSettings: entry.snapshot(settingsTenant),
          });
          expect(
            settingsControls(fixture.componentInstance).saveOutcome(),
          ).toBe('stale');
          expect(
            settingsControls(fixture.componentInstance).settingsPhase(),
          ).toBeNull();
          expect(
            settingsControls(fixture.componentInstance).settingsLocked(),
          ).toBe(true);
          expect(input.value).toBe(entry.input);
          expect(input.disabled).toBe(true);
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            true,
          );
          const confirmDiscard = vi.fn(() => false);
          expect(
            tenantSettingsCanDeactivate(
              fixture.componentInstance,
              confirmDiscard,
            ),
          ).toBe(false);
          expect(confirmDiscard).toHaveBeenCalledOnce();
          const content = root.textContent?.replaceAll(/\s+/g, ' ');
          expect(content).toContain('Your changes were not saved.');
          expect(content).toContain('Copy any changes you want to keep');
          expect(content).not.toContain('Your settings were saved');
          expect(content).not.toContain('We could not confirm');
          expect(readConfig).toHaveBeenCalledTimes(1);
          expect(showError).not.toHaveBeenCalled();
          expect(showSuccess).not.toHaveBeenCalled();
          expect(reload).not.toHaveBeenCalled();

          await settingsControls(fixture.componentInstance).save(
            new Event('submit'),
          );
          expect(saveMutation).toHaveBeenCalledTimes(1);
          const reloadButton = [...root.querySelectorAll('button')].find(
            (button) => button.textContent?.trim() === 'Load latest settings',
          );
          if (!reloadButton)
            throw new Error('Expected stale settings reload action');
          expect(reloadButton.disabled).toBe(false);
          reloadButton.click();
          expect(reload).toHaveBeenCalledTimes(1);
          expect(saveMutation).toHaveBeenCalledTimes(1);
          expect(readConfig).toHaveBeenCalledTimes(1);
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            true,
          );
          expect(
            settingsControls(fixture.componentInstance).saveOutcome(),
          ).toBe('stale');
        },
      );
    });

    it(`${entry.name}: captures the successfully read settings with the next hydrated form`, async () => {
      await withSettingsFixture(
        entry,
        async ({
          fixture,
          input,
          readConfig,
          root,
          savedTenant,
          saveMutation,
          showSuccess,
          track,
        }) => {
          await track(
            settingsControls(fixture.componentInstance).save(
              new Event('submit'),
            ),
          );
          await fixture.whenStable();
          fixture.detectChanges();
          expect(showSuccess).toHaveBeenCalledExactlyOnceWith(entry.success);
          expect(readConfig).toHaveBeenCalledTimes(1);
          expect(input.value).toBe(entry.input.trim());
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            false,
          );
          expect(
            settingsControls(fixture.componentInstance).saveOutcome(),
          ).toBeNull();

          input.value =
            entry.name === 'registration'
              ? '8'
              : entry.name === 'payment'
                ? 'https://cards.example.test/another'
                : 'Second edit';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          fixture.detectChanges();
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            true,
          );
          const saveButton = root.querySelector('button[type="submit"]');
          if (!(saveButton instanceof HTMLButtonElement))
            throw new Error('Expected settings save action');
          expect(saveButton.disabled).toBe(false);
          saveMutation.mockRejectedValueOnce(tenantSettingsConflict());
          await track(
            settingsControls(fixture.componentInstance).save(
              new Event('submit'),
            ),
          );
          expect(saveMutation).toHaveBeenCalledTimes(2);
          expect(saveMutation.mock.calls[1]?.[0]).toMatchObject({
            expectedSettings: entry.snapshot(savedTenant),
          });
          expect(readConfig).toHaveBeenCalledTimes(1);
        },
      );
    });

    it(`${entry.name}: does not mark a pristine form dirty while saving or retaining an unknown outcome`, async () => {
      await withSettingsFixture(
        entry,
        async ({ defer, fixture, saveMutation, showSuccess, track }) => {
          settingsControls(fixture.componentInstance).settingsForm().reset();
          fixture.detectChanges();
          await fixture.whenStable();
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            false,
          );
          const mutation = defer<undefined>(undefined);
          saveMutation.mockImplementationOnce(async () => {
            await mutation.promise;
            throw new RpcInternalServerError({
              message: 'Unconfirmed pristine save',
            });
          });
          const saving = track(
            settingsControls(fixture.componentInstance).save(
              new Event('submit'),
            ),
          );
          await vi.waitFor(() => expect(saveMutation).toHaveBeenCalledTimes(1));
          expect(
            settingsControls(fixture.componentInstance).settingsPhase(),
          ).toBe('saving');
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            false,
          );
          mutation.resolve(undefined);
          await saving;
          fixture.detectChanges();
          expect(
            settingsControls(fixture.componentInstance).saveOutcome(),
          ).toBe('unknown');
          expect(
            settingsControls(fixture.componentInstance).settingsLocked(),
          ).toBe(true);
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            false,
          );
          await settingsControls(fixture.componentInstance).save(
            new Event('submit'),
          );
          expect(saveMutation).toHaveBeenCalledTimes(1);
          expect(showSuccess).not.toHaveBeenCalled();
        },
      );
    });

    it(`${entry.name}: retains fields and blocks a second write throughout mutation and successful settings read`, async () => {
      await withSettingsFixture(
        entry,
        async ({
          defer,
          fixture,
          input,
          queryClient,
          readConfig,
          reload,
          root,
          savedTenant,
          saveMutation,
          showSuccess,
          track,
        }) => {
          const mutation = defer<undefined>(undefined);
          const read = defer(savedTenant);
          saveMutation.mockReturnValueOnce(mutation.promise);
          readConfig.mockReturnValueOnce(read.promise);
          const saving = track(
            settingsControls(fixture.componentInstance).save(
              new Event('submit'),
            ),
          );
          await vi.waitFor(() => expect(saveMutation).toHaveBeenCalledTimes(1));
          fixture.detectChanges();
          expect(input.disabled).toBe(true);
          expect(
            settingsControls(fixture.componentInstance).settingsPhase(),
          ).toBe('saving');
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            true,
          );
          await settingsControls(fixture.componentInstance).save(
            new Event('submit'),
          );
          expect(saveMutation).toHaveBeenCalledTimes(1);
          expect(saveMutation).toHaveBeenCalledWith(
            {
              ...entry.payload,
              expectedSettings: entry.snapshot(settingsTenant),
            },
            {
              client: queryClient,
              meta: { rpc: { path: ['admin', 'tenant', entry.procedure] } },
              mutationKey: [
                ['rpc', 'admin', 'tenant', entry.procedure],
                { type: 'mutation' },
              ],
            },
          );
          mutation.resolve(undefined);
          await vi.waitFor(() => expect(readConfig).toHaveBeenCalledTimes(1));
          fixture.detectChanges();
          expect(root.textContent).toContain(
            'Your settings were saved. Loading current settings',
          );
          expect(
            settingsControls(fixture.componentInstance).settingsPhase(),
          ).toBe('reading');
          expect(input.value).toBe(entry.input);
          expect(input.disabled).toBe(true);
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            true,
          );
          expect(showSuccess).not.toHaveBeenCalled();
          expect(reload).not.toHaveBeenCalled();
          for (const select of root.querySelectorAll('mat-select'))
            expect(select.getAttribute('aria-disabled')).toBe('true');
          if (fixture.componentInstance instanceof AppearanceSettingsComponent)
            expect(
              fixture.componentInstance['brandAssetUploadDisabled'](),
            ).toBe(true);
          await settingsControls(fixture.componentInstance).save(
            new Event('submit'),
          );
          expect(saveMutation).toHaveBeenCalledTimes(1);
          read.resolve(savedTenant);
          await saving;
          fixture.detectChanges();
          expect(showSuccess).toHaveBeenCalledExactlyOnceWith(entry.success);
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            false,
          );
          expect(
            settingsControls(fixture.componentInstance).settingsLocked(),
          ).toBe(false);
          expect(input.disabled).toBe(false);
          expect(reload).not.toHaveBeenCalled();
        },
      );
    });

    it(`${entry.name}: retains an unknown save outcome without exposing raw errors or submitting again`, async () => {
      await withSettingsFixture(
        entry,
        async ({
          configSignal,
          fixture,
          input,
          readConfig,
          reload,
          root,
          saveMutation,
          showError,
          showSuccess,
        }) => {
          saveMutation.mockRejectedValueOnce(
            new RpcInternalServerError({ message: 'private database failure' }),
          );
          await settingsControls(fixture.componentInstance).save(
            new Event('submit'),
          );
          configSignal.set(
            new ClientTenantConfig({
              ...settingsTenant,
              name: 'Background update',
            }),
          );
          fixture.detectChanges();
          expect(root.textContent).toContain(
            'We could not confirm whether your settings were saved.',
          );
          expect(root.textContent).not.toContain('private database failure');
          expect(root.textContent?.replaceAll(/\s+/g, ' ')).toContain(
            'This replaces these entries with the saved values.',
          );
          expect(input.value).toBe(entry.input);
          expect(input.disabled).toBe(true);
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            true,
          );
          expect(readConfig).not.toHaveBeenCalled();
          expect(showSuccess).not.toHaveBeenCalled();
          expect(showError).not.toHaveBeenCalled();
          await settingsControls(fixture.componentInstance).save(
            new Event('submit'),
          );
          expect(saveMutation).toHaveBeenCalledTimes(1);
          const reloadButton = [...root.querySelectorAll('button')].find(
            (button) => button.textContent?.trim() === 'Load saved settings',
          );
          if (!reloadButton)
            throw new Error('Expected read-only settings reload');
          expect(reloadButton.disabled).toBe(false);
          reloadButton.click();
          expect(reload).toHaveBeenCalledTimes(1);
          expect(saveMutation).toHaveBeenCalledTimes(1);
          expect(
            settingsControls(fixture.componentInstance).saveOutcome(),
          ).toBe('unknown');
        },
      );
    });

    it(`${entry.name}: shows the confirmed write when current settings cannot be read`, async () => {
      await withSettingsFixture(
        entry,
        async ({
          fixture,
          input,
          readConfig,
          reload,
          root,
          saveMutation,
          showSuccess,
        }) => {
          readConfig.mockRejectedValueOnce(new Error('settings read failed'));
          await settingsControls(fixture.componentInstance).save(
            new Event('submit'),
          );
          fixture.detectChanges();
          expect(root.textContent).toContain(
            'Your settings were saved, but the current settings could not be loaded.',
          );
          expect(
            settingsControls(fixture.componentInstance).saveOutcome(),
          ).toBe('saved-read-failed');
          expect(input.value).toBe(entry.input);
          expect(input.disabled).toBe(true);
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            true,
          );
          expect(showSuccess).not.toHaveBeenCalled();
          expect(reload).not.toHaveBeenCalled();
          await settingsControls(fixture.componentInstance).save(
            new Event('submit'),
          );
          expect(saveMutation).toHaveBeenCalledTimes(1);
        },
      );
    });

    it(`${entry.name}: keeps a typed validation denial correctable`, async () => {
      await withSettingsFixture(
        entry,
        async ({
          fixture,
          input,
          readConfig,
          saveMutation,
          showError,
          showSuccess,
        }) => {
          saveMutation.mockRejectedValueOnce(
            new RpcBadRequestError({
              message: 'Check the submitted settings.',
            }),
          );
          await settingsControls(fixture.componentInstance).save(
            new Event('submit'),
          );
          fixture.detectChanges();
          expect(showError).toHaveBeenCalledExactlyOnceWith(
            'Check the submitted settings.',
          );
          expect(showSuccess).not.toHaveBeenCalled();
          expect(readConfig).not.toHaveBeenCalled();
          expect(input.value).toBe(entry.input);
          expect(input.disabled).toBe(false);
          expect(
            settingsControls(fixture.componentInstance).saveOutcome(),
          ).toBeNull();
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            true,
          );
        },
      );
    });
  }
});

const settingsCase = (name: string) => {
  const entry = settingsCases.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`Missing settings test case: ${name}`);
  return entry;
};

describe('focused settings follow-up read ownership', () => {
  for (const sibling of ['config', 'provider']) {
    it(`drains an active ${sibling} sibling after the first failed read before unlocking the saved outcome`, async () => {
      await withSettingsFixture(
        settingsCase('payment'),
        async ({
          defer,
          fixture,
          input,
          observe,
          queryClient,
          readConfig,
          savedTenant,
          saveMutation,
          showSuccess,
          track,
        }) => {
          const siblingData =
            sibling === 'provider' ? settingsProviders : savedTenant;
          const held = defer(siblingData);
          const siblingKey =
            sibling === 'provider'
              ? settingsProviderKey
              : createRpcQueryKey(['config', 'tenant'], {
                  input: { observer: 'held settings view' },
                  keyPrefix: 'rpc',
                  type: 'query',
                });
          const siblingRead = vi.fn(() => held.promise);
          observe(siblingKey, siblingRead, siblingData);
          readConfig.mockRejectedValueOnce(
            new Error('first settings read failed'),
          );
          let completed = false;
          const saving = track(
            settingsControls(fixture.componentInstance)
              .save(new Event('submit'))
              .then(() => {
                completed = true;
              }),
          );
          await vi.waitFor(() => {
            expect(queryClient.getQueryState(settingsConfigKey)?.status).toBe(
              'error',
            );
            expect(siblingRead).toHaveBeenCalledTimes(1);
          });
          fixture.detectChanges();
          expect(completed).toBe(false);
          expect(
            settingsControls(fixture.componentInstance).settingsPhase(),
          ).toBe('reading');
          expect(
            settingsControls(fixture.componentInstance).saveOutcome(),
          ).toBeNull();
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            true,
          );
          expect(input.disabled).toBe(true);
          expect(showSuccess).not.toHaveBeenCalled();
          await settingsControls(fixture.componentInstance).save(
            new Event('submit'),
          );
          expect(saveMutation).toHaveBeenCalledTimes(1);
          held.resolve(siblingData);
          await saving;
          expect(
            settingsControls(fixture.componentInstance).saveOutcome(),
          ).toBe('saved-read-failed');
          expect(
            settingsControls(fixture.componentInstance).settingsPhase(),
          ).toBeNull();
          expect(
            settingsControls(fixture.componentInstance).settingsLocked(),
          ).toBe(true);
          expect(completed).toBe(true);
        },
      );
    });
  }

  it('does not wait for inactive, disabled, static, or unrelated reads', async () => {
    await withSettingsFixture(
      settingsCase('payment'),
      async ({
        defer,
        fixture,
        observe,
        queryClient,
        savedTenant,
        showSuccess,
        track,
      }) => {
        const held = defer(savedTenant);
        const inactiveKey = createRpcQueryKey(['config', 'tenant'], {
          input: { observer: 'inactive' },
          keyPrefix: 'rpc',
          type: 'query',
        });
        let inactiveSettled = false;
        const inactiveResult = queryClient
          .fetchQuery({ queryFn: () => held.promise, queryKey: inactiveKey })
          .then(
            () => {
              inactiveSettled = true;
            },
            (error: unknown) => {
              inactiveSettled = true;
              throw error;
            },
          );
        // Attach a terminal rejection observer before assertions or cleanup can fail.
        const inactiveSettlement = inactiveResult.then(
          () => ({ status: 'fulfilled' as const }),
          (error: unknown) => ({ reason: error, status: 'rejected' as const }),
        );
        void track(
          inactiveSettlement.then((result) => {
            if (result.status === 'rejected') throw result.reason;
          }),
        );
        const disabledRead = vi.fn(async () => savedTenant);
        const staticRead = vi.fn(async () => savedTenant);
        const unrelatedRead = vi.fn(async () => savedTenant);
        observe(
          createRpcQueryKey(['config', 'tenant'], {
            input: { observer: 'disabled' },
            keyPrefix: 'rpc',
            type: 'query',
          }),
          disabledRead,
          settingsTenant,
          false,
        );
        observe(
          createRpcQueryKey(['config', 'tenant'], {
            input: { observer: 'static' },
            keyPrefix: 'rpc',
            type: 'query',
          }),
          staticRead,
          settingsTenant,
          true,
          'static',
        );
        observe(
          createRpcQueryKey(['config', 'permissions'], {
            keyPrefix: 'rpc',
            type: 'query',
          }),
          unrelatedRead,
          settingsTenant,
        );
        await settingsControls(fixture.componentInstance).save(
          new Event('submit'),
        );
        expect(inactiveSettled).toBe(false);
        expect(showSuccess).toHaveBeenCalledExactlyOnceWith(
          'Payment settings updated',
        );
        expect(disabledRead).not.toHaveBeenCalled();
        expect(staticRead).not.toHaveBeenCalled();
        expect(unrelatedRead).not.toHaveBeenCalled();
        held.resolve(savedTenant);
        expect(await inactiveSettlement).toEqual({ status: 'fulfilled' });
      },
    );
  });

  it('does not treat a cancelled read reverted to old successful data as current', async () => {
    await withSettingsFixture(
      settingsCase('organization'),
      async ({
        defer,
        fixture,
        input,
        queryClient,
        readConfig,
        reload,
        savedTenant,
        showSuccess,
        track,
      }) => {
        const held = defer(savedTenant);
        readConfig.mockReturnValueOnce(held.promise);
        const saving = track(
          settingsControls(fixture.componentInstance).save(new Event('submit')),
        );
        await vi.waitFor(() =>
          expect(
            queryClient.getQueryState(settingsConfigKey)?.fetchStatus,
          ).toBe('fetching'),
        );
        await queryClient.cancelQueries(settingsConfigFilter, { revert: true });
        await saving;
        fixture.detectChanges();
        expect(queryClient.getQueryState(settingsConfigKey)).toMatchObject({
          data: settingsTenant,
          fetchStatus: 'idle',
          isInvalidated: true,
          status: 'success',
        });
        expect(settingsControls(fixture.componentInstance).saveOutcome()).toBe(
          'saved-read-failed',
        );
        expect(input.value).toBe(settingsCase('organization').input);
        expect(input.disabled).toBe(true);
        expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
          true,
        );
        expect(showSuccess).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
      },
    );
  });

  it('requires an actual config observer even when an active provider read succeeds', async () => {
    await withSettingsFixture(
      settingsCase('payment'),
      async ({ fixture, observe, readConfig, showSuccess, stopConfig }) => {
        stopConfig();
        const providerRead = vi.fn(async () => settingsProviders);
        observe(settingsProviderKey, providerRead, settingsProviders);
        await settingsControls(fixture.componentInstance).save(
          new Event('submit'),
        );
        expect(readConfig).not.toHaveBeenCalled();
        expect(providerRead).toHaveBeenCalledTimes(1);
        expect(settingsControls(fixture.componentInstance).saveOutcome()).toBe(
          'saved-read-failed',
        );
        expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
          true,
        );
        expect(showSuccess).not.toHaveBeenCalled();
      },
    );
  });

  it('keeps a confirmed save blocked when the settings read is initially paused', async () => {
    await withSettingsFixture(
      settingsCase('legal'),
      async ({
        defer,
        fixture,
        queryClient,
        readConfig,
        root,
        saveMutation,
        showSuccess,
        track,
      }) => {
        const mutation = defer<undefined>(undefined);
        saveMutation.mockReturnValueOnce(mutation.promise);
        const saving = track(
          settingsControls(fixture.componentInstance).save(new Event('submit')),
        );
        await vi.waitFor(() => expect(saveMutation).toHaveBeenCalledTimes(1));
        onlineManager.setOnline(false);
        mutation.resolve(undefined);
        await saving;
        fixture.detectChanges();
        expect(queryClient.getQueryState(settingsConfigKey)?.fetchStatus).toBe(
          'paused',
        );
        expect(readConfig).not.toHaveBeenCalled();
        expect(root.textContent).toContain(
          'Your settings were saved, but loading the current settings is paused.',
        );
        expect(settingsControls(fixture.componentInstance).saveOutcome()).toBe(
          'saved-read-paused',
        );
        expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
          true,
        );
        expect(showSuccess).not.toHaveBeenCalled();
        await settingsControls(fixture.componentInstance).save(
          new Event('submit'),
        );
        expect(saveMutation).toHaveBeenCalledTimes(1);
      },
    );
  });

  for (const denial of [
    {
      error: new RpcUnauthorizedError({ message: 'private sign-in detail' }),
      message: 'Sign in again before changing these settings.',
    },
    {
      error: new RpcForbiddenError({ message: 'private access detail' }),
      message:
        'Your account does not have access to change these settings. Ask an administrator to check your access.',
    },
    {
      error: new AdminTenantNotFoundError({
        message: 'The organization was not found.',
      }),
      message: 'The organization was not found.',
    },
  ]) {
    it(`keeps ${denial.error._tag} explicit and correctable without leaking private error details`, async () => {
      await withSettingsFixture(
        settingsCase('legal'),
        async ({ fixture, input, readConfig, saveMutation, showError }) => {
          saveMutation.mockRejectedValueOnce(denial.error);
          await settingsControls(fixture.componentInstance).save(
            new Event('submit'),
          );
          fixture.detectChanges();
          expect(showError).toHaveBeenCalledExactlyOnceWith(denial.message);
          expect(input.disabled).toBe(false);
          expect(
            settingsControls(fixture.componentInstance).saveOutcome(),
          ).toBeNull();
          expect(fixture.componentInstance.hasUnsavedSettingsChanges()).toBe(
            true,
          );
          expect(readConfig).not.toHaveBeenCalled();
        },
      );
    });
  }

  for (const name of ['organization', 'payment']) {
    it(`${name}: reloads after a changed time zone or currency only once its saved settings are read`, async () => {
      await withSettingsFixture(
        settingsCase(name),
        async ({
          defer,
          fixture,
          queryClient,
          readConfig,
          reload,
          savedTenant,
          track,
        }) => {
          const component = fixture.componentInstance;
          if (component instanceof OrganizationSettingsComponent)
            component['settingsForm'].timezone().value.set('Europe/Paris');
          else if (component instanceof PaymentProviderSettingsComponent)
            component['settingsForm'].currency().value.set('AUD');
          else
            throw new Error('Expected a settings page with conditional reload');
          const updated =
            name === 'organization'
              ? new ClientTenantConfig({
                  ...savedTenant,
                  timezone: 'Europe/Paris',
                })
              : new ClientTenantConfig({ ...savedTenant, currency: 'AUD' });
          const held = defer(updated);
          readConfig.mockReturnValueOnce(held.promise);
          const saving = track(
            settingsControls(component).save(new Event('submit')),
          );
          await vi.waitFor(() =>
            expect(
              queryClient.getQueryState(settingsConfigKey)?.fetchStatus,
            ).toBe('fetching'),
          );
          expect(reload).not.toHaveBeenCalled();
          held.resolve(updated);
          await saving;
          expect(reload).toHaveBeenCalledTimes(1);
        },
      );
    });
  }
});

describe('focused settings named optional payloads', () => {
  for (const name of ['organization', 'payment', 'appearance', 'legal']) {
    for (const blank of [false, true]) {
      it(`${name}: preserves every named optional field in a ${blank ? 'blank' : 'padded'} save payload`, async () => {
        const entry = settingsCase(name);
        await withSettingsFixture(
          entry,
          async ({
            fixture,
            queryClient,
            readConfig,
            reload,
            root,
            saveMutation,
            showSuccess,
            track,
          }) => {
            const component = fixture.componentInstance;
            const fill = (label: string, padded: string, empty = '') => {
              const input = settingsInput(root, label);
              const value = blank ? empty : padded;
              input.value = value;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              expect(input.value).toBe(value);
            };
            let expectedPayload: object;
            let expectedTenant: ClientTenantConfig;
            let expectedReloads = 0;
            if (component instanceof OrganizationSettingsComponent) {
              fill('Reply name', ' Example Section ');
              fill('Reply email address', 'events@section.example.org');
              // Email inputs trim whitespace, so also exercise the raw form boundary.
              const replyEmail = blank ? '' : ' events@section.example.org ';
              component['settingsForm']
                .emailSenderEmail()
                .value.set(replyEmail);
              expect(component['settingsForm'].emailSenderEmail().value()).toBe(
                replyEmail,
              );
              const defaultLocation: NonNullable<
                ClientTenantConfig['defaultLocation']
              > = {
                address: 'Amsterdam, Netherlands',
                coordinates: { lat: 52.3676, lng: 4.9041 },
                name: 'Amsterdam',
                placeId: 'place-amsterdam',
                type: 'google',
              };
              component['settingsForm']
                .defaultLocation()
                .value.set(blank ? null : defaultLocation);
              component['settingsForm'].timezone().value.set('Europe/Prague');
              expectedPayload = {
                defaultLocation: blank ? null : defaultLocation,
                emailSenderEmail: blank
                  ? undefined
                  : 'events@section.example.org',
                emailSenderName: blank ? undefined : 'Example Section',
                timezone: 'Europe/Prague',
              };
              expectedTenant = new ClientTenantConfig({
                ...settingsTenant,
                defaultLocation: blank ? undefined : defaultLocation,
                emailSenderEmail: blank
                  ? undefined
                  : 'events@section.example.org',
                emailSenderName: blank ? undefined : 'Example Section',
                timezone: 'Europe/Prague',
              });
              expectedReloads = 1;
            } else if (component instanceof PaymentProviderSettingsComponent) {
              fill(
                'ESNcard purchase web address',
                ' https://esncard.org/ ',
                ' ',
              );
              component['settingsForm'].allowOther().value.set(true);
              component['settingsForm'].currency().value.set('CZK');
              component['settingsForm']
                .receiptCountries()
                .value.set(['DE', 'NL']);
              expectedPayload = {
                allowOther: true,
                buyEsnCardUrl: blank ? undefined : 'https://esncard.org/',
                currency: 'CZK',
                esnCardEnabled: true,
                receiptCountries: ['DE', 'NL'],
                refundFeesOnCancellation: false,
              };
              expectedTenant = new ClientTenantConfig({
                ...settingsTenant,
                currency: 'CZK',
                discountProviders: {
                  esnCard: {
                    config: blank
                      ? {}
                      : { buyEsnCardUrl: 'https://esncard.org/' },
                    status: 'enabled',
                  },
                },
                receiptSettings: {
                  allowOther: true,
                  receiptCountries: ['DE', 'NL'],
                },
              });
              expectedReloads = 1;
            } else if (component instanceof AppearanceSettingsComponent) {
              fill(
                'Tab icon web address',
                ' https://cdn.example.org/favicon.ico ',
              );
              fill('Logo web address', ' https://cdn.example.org/logo.svg ');
              fill('Search result description', ' Public tenant description ');
              fill('Search result title', ' Public tenant title ');
              component['settingsForm']
                .theme()
                .value.set(blank ? 'esn' : 'classic');
              expectedPayload = {
                faviconUrl: blank
                  ? undefined
                  : 'https://cdn.example.org/favicon.ico',
                logoUrl: blank ? undefined : 'https://cdn.example.org/logo.svg',
                seoDescription: blank ? undefined : 'Public tenant description',
                seoTitle: blank ? undefined : 'Public tenant title',
                theme: blank ? 'esn' : 'classic',
              };
              expectedTenant = new ClientTenantConfig({
                ...settingsTenant,
                faviconUrl: blank
                  ? undefined
                  : 'https://cdn.example.org/favicon.ico',
                logoUrl: blank ? undefined : 'https://cdn.example.org/logo.svg',
                seoDescription: blank ? undefined : 'Public tenant description',
                seoTitle: blank ? undefined : 'Public tenant title',
                theme: blank ? 'esn' : 'classic',
              });
            } else if (component instanceof LegalSettingsComponent) {
              fill(
                'Imprint / legal notice text published by Evorto',
                ' Tenant imprint text ',
              );
              fill(
                'Imprint / legal notice web address',
                ' https://section.example.org/imprint ',
              );
              fill('Terms text published by Evorto', ' Tenant terms text ');
              fill('Terms web address', ' https://section.example.org/terms ');
              expectedPayload = {
                legalNoticeText: blank ? undefined : 'Tenant imprint text',
                legalNoticeUrl: blank
                  ? undefined
                  : 'https://section.example.org/imprint',
                termsText: blank ? undefined : 'Tenant terms text',
                termsUrl: blank
                  ? undefined
                  : 'https://section.example.org/terms',
              };
              expectedTenant = new ClientTenantConfig({
                ...settingsTenant,
                legalNoticeText: blank ? undefined : 'Tenant imprint text',
                legalNoticeUrl: blank
                  ? undefined
                  : 'https://section.example.org/imprint',
                termsText: blank ? undefined : 'Tenant terms text',
                termsUrl: blank
                  ? undefined
                  : 'https://section.example.org/terms',
              });
            } else {
              throw new TypeError(
                'Expected a settings page with optional fields',
              );
            }
            readConfig.mockResolvedValue(expectedTenant);
            fixture.detectChanges();
            expect(settingsControls(component).settingsForm().invalid()).toBe(
              false,
            );
            expect(component.hasUnsavedSettingsChanges()).toBe(true);
            await track(settingsControls(component).save(new Event('submit')));
            fixture.detectChanges();
            expect(saveMutation).toHaveBeenCalledExactlyOnceWith(
              {
                ...expectedPayload,
                expectedSettings: entry.snapshot(settingsTenant),
              },
              {
                client: queryClient,
                meta: { rpc: { path: ['admin', 'tenant', entry.procedure] } },
                mutationKey: [
                  ['rpc', 'admin', 'tenant', entry.procedure],
                  { type: 'mutation' },
                ],
              },
            );
            expect(readConfig).toHaveBeenCalledTimes(1);
            expect(queryClient.getQueryData(settingsConfigKey)).toEqual(
              expectedTenant,
            );
            expect(showSuccess).toHaveBeenCalledExactlyOnceWith(entry.success);
            expect(component.hasUnsavedSettingsChanges()).toBe(false);
            expect(reload).toHaveBeenCalledTimes(expectedReloads);
          },
        );
      });
    }
  }
});
