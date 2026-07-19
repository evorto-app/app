import '@angular/compiler';

import type { TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';
import type { IconValue } from '@shared/types/icon';

import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, expect, vi } from 'vitest';

import type { EventLocationType } from '../../../types/location';

import { NotificationService } from '../../core/notification.service';
import { EditorComponent } from '../../shared/components/controls/editor/editor.component';
import { LocationSelectorField } from '../../shared/components/controls/location-selector/location-selector-field/location-selector-field';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';
import { PLATFORM_EVENT_OPERATION_ROUTES } from './platform-event-operations.routes';
import {
  PlatformTemplateEditorComponent,
  platformTemplateEditorDataReady,
  PlatformTemplateEditorOperations,
  platformTemplateFormToPayload,
  platformTemplateIconChoiceToValue,
  platformTemplateModeTransitionIssue,
  platformTemplateRecordToFormModel,
} from './platform-template-editor.component';
import { platformTemplateUnsavedChangesGuard } from './platform-template-unsaved-changes.guard';

@Component({ selector: 'app-editor', template: '' })
class EditorStub {
  readonly control = input<unknown>();
}

@Component({ selector: 'app-icon', template: '' })
class IconStub {
  readonly iconCommonName = input.required<IconValue>();
  readonly size = input(24);
}

@Component({ selector: 'app-location-selector-field', template: '' })
class LocationSelectorFieldStub {
  readonly value = input<EventLocationType | null>(null);
  readonly valueChange = output<EventLocationType | null>();
}

@Component({ selector: 'app-platform-tenant-page-header', template: '' })
class PlatformTenantPageHeaderStub {
  readonly tenantId = input.required<string>();
  readonly title = input.required<string>();
}

describe('platform template editor readiness', () => {
  it('guards both template editor routes', () => {
    const guardedPaths = PLATFORM_EVENT_OPERATION_ROUTES.filter((route) =>
      route.path?.includes('/templates/'),
    );

    expect(guardedPaths.map((route) => route.path)).toEqual([
      'tenants/:tenantId/templates/new',
      'tenants/:tenantId/templates/:templateId',
    ]);
    for (const route of guardedPaths) {
      expect(route.canDeactivate).toEqual([
        platformTemplateUnsavedChangesGuard,
      ]);
    }
  });

  it('uses the target catalog color when an icon is selected', () => {
    expect(
      platformTemplateIconChoiceToValue({
        commonName: 'calendar:fas',
        sourceColor: 42,
      }),
    ).toEqual({ iconColor: 42, iconName: 'calendar:fas' });
    expect(
      platformTemplateIconChoiceToValue({
        commonName: 'calendar:fas',
        sourceColor: null,
      }),
    ).toEqual({ iconColor: 0, iconName: 'calendar:fas' });
  });

  it('keeps saves blocked until all provider-backed editor data is resolved', () => {
    expect(
      platformTemplateEditorDataReady({
        optionsResolved: false,
        rolesResolved: true,
        templateRequired: true,
        templateResolved: true,
      }),
    ).toBe(false);
    expect(
      platformTemplateEditorDataReady({
        optionsResolved: true,
        rolesResolved: true,
        templateRequired: true,
        templateResolved: true,
      }),
    ).toBe(true);
    expect(
      platformTemplateEditorDataReady({
        optionsResolved: true,
        rolesResolved: true,
        templateRequired: false,
        templateResolved: false,
      }),
    ).toBe(true);
  });
});

describe('PlatformTemplateEditorComponent recovery', () => {
  let optionFailuresRemaining = 0;
  let queryClient: QueryClient;
  const loadOptions = vi.fn(async () => {
    if (optionFailuresRemaining > 0) {
      optionFailuresRemaining -= 1;
      throw new Error('Category provider unavailable');
    }
    return {
      categories: [{ id: 'category-1', title: 'Trips' }],
      esnCardEnabled: false,
      iconChoices: [
        {
          commonName: 'calendar:fas',
          friendlyName: 'Calendar',
          id: 'icon-1',
          sourceColor: 42,
        },
      ],
    };
  });

  beforeEach(async () => {
    optionFailuresRemaining = 0;
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    TestBed.overrideComponent(PlatformTemplateEditorComponent, {
      add: {
        imports: [
          EditorStub,
          IconStub,
          LocationSelectorFieldStub,
          PlatformTenantPageHeaderStub,
        ],
      },
      remove: {
        imports: [
          EditorComponent,
          IconComponent,
          LocationSelectorField,
          PlatformTenantPageHeaderComponent,
        ],
      },
    });
    await TestBed.configureTestingModule({
      imports: [PlatformTemplateEditorComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: MatDialog, useValue: { open: vi.fn() } },
        {
          provide: NotificationService,
          useValue: { showError: vi.fn(), showSuccess: vi.fn() },
        },
        {
          provide: PlatformTemplateEditorOperations,
          useValue: {
            create: () => ({
              mutationFn: vi.fn(),
              mutationKey: ['platform-template', 'create'],
            }),
            findOne: () => ({
              queryFn: vi.fn(),
              queryKey: ['platform-template', 'detail'],
            }),
            formOptions: () => ({
              queryFn: loadOptions,
              queryKey: ['platform-template', 'options'],
            }),
            roles: () => ({
              queryFn: async () => [
                {
                  defaultOrganizerRole: true,
                  defaultUserRole: true,
                  id: 'role-1',
                  name: 'Member',
                },
              ],
              queryKey: ['platform-template', 'roles'],
            }),
            taxRates: () => ({
              queryFn: async () => [],
              queryKey: ['platform-template', 'tax-rates'],
            }),
            templateFilter: () => ({
              queryKey: ['platform', 'templates'],
            }),
            tenant: () => ({
              queryFn: async () => ({
                currency: 'EUR',
                stripeConnected: true,
              }),
              queryKey: ['platform-template', 'tenant'],
            }),
            update: () => ({
              mutationFn: vi.fn(),
              mutationKey: ['platform-template', 'update'],
            }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  const render = (): ComponentFixture<PlatformTemplateEditorComponent> => {
    const fixture = TestBed.createComponent(PlatformTemplateEditorComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    return fixture;
  };

  it('retries failed target-organization form options from the page', async () => {
    optionFailuresRemaining = 1;
    const fixture = render();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain('Try again');
    });

    const retry = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) => button.textContent?.trim() === 'Try again',
    );
    if (!retry) throw new Error('Expected the editor retry action');
    retry.click();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="platform-template-editor"]',
        ),
      ).not.toBeNull();
    });
    expect(loadOptions).toHaveBeenCalledTimes(2);
    const renderedText = fixture.nativeElement.textContent.replaceAll(
      /\s+/g,
      ' ',
    );
    expect(renderedText).toContain('Calendar');
    expect(renderedText).not.toContain('Icon name');
    expect(renderedText).not.toContain('Google place ID');
  });

  it('explains that blank deadlines inherit the organization defaults', async () => {
    const fixture = render();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="platform-template-editor"]',
        ),
      ).not.toBeNull();
    });

    const text = fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ');
    expect(
      text.match(/Leave blank to use the organization default\./g),
    ).toHaveLength(4);
    expect(text).not.toContain('Leave blank for no template deadline.');
  });

  it('warns before route or browser navigation discards template work', async () => {
    const fixture = render();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="platform-template-editor"]',
        ),
      ).not.toBeNull();
    });
    expect(fixture.componentInstance.canDeactivate()).toBe(true);

    const title = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input');
    if (!title) throw new Error('Expected the template title input');
    title.value = 'Changed template title';
    title.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const confirmDiscard = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmDiscard);
    expect(fixture.componentInstance.canDeactivate()).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledWith(
      'You have unsaved template changes. Leave this page and discard them?',
    );

    const beforeUnload = new Event('beforeunload', { cancelable: true });
    globalThis.window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    confirmDiscard.mockReturnValue(true);
    expect(fixture.componentInstance.canDeactivate()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('keeps navigation blocked while dirty editor data is refetching', async () => {
    const fixture = render();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="platform-template-editor"]',
        ),
      ).not.toBeNull();
    });

    const title = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input');
    if (!title) throw new Error('Expected the template title input');
    title.value = 'Changed during a refresh';
    title.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    let resolveRefetch:
      ((options: Awaited<ReturnType<typeof loadOptions>>) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const pendingOptions = new Promise<Awaited<ReturnType<typeof loadOptions>>>(
      (resolve) => {
        resolveRefetch = resolve;
      },
    );
    loadOptions.mockImplementationOnce(() => pendingOptions);
    const refetch = queryClient.refetchQueries({
      exact: true,
      queryKey: ['platform-template', 'options'],
    });

    await vi.waitFor(() => {
      expect(
        queryClient.getQueryState(['platform-template', 'options'])
          ?.fetchStatus,
      ).toBe('fetching');
    });
    const confirmDiscard = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmDiscard);
    expect(fixture.componentInstance.canDeactivate()).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledOnce();

    if (!resolveRefetch) throw new Error('Expected the refetch to start');
    resolveRefetch({
      categories: [{ id: 'category-1', title: 'Trips' }],
      esnCardEnabled: false,
      iconChoices: [
        {
          commonName: 'calendar:fas',
          friendlyName: 'Calendar',
          id: 'icon-1',
          sourceColor: 42,
        },
      ],
    });
    await refetch;
  });
});

const completeTemplate = (): TemplateGraphRecord => ({
  addOns: [
    {
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: true,
      allowPurchaseDuringRegistration: false,
      description: 'Add-on description',
      id: 'addon-1',
      isPaid: true,
      maxQuantityPerUser: 3,
      price: 450,
      registrationOptions: [
        {
          includedQuantity: 2,
          optionalPurchaseQuantity: 0,
          registrationOptionId: 'organizer-option',
        },
        {
          includedQuantity: 0,
          optionalPurchaseQuantity: 1,
          registrationOptionId: 'participant-option',
        },
      ],
      stripeTaxRateId: 'txr-addon',
      title: 'Dinner',
      totalAvailableQuantity: 40,
    },
  ],
  categoryId: 'category-1',
  description: '<p>Template description</p>',
  icon: { iconColor: 4, iconName: 'campground:fas' },
  id: 'template-1',
  location: {
    address: 'Main Street 1',
    coordinates: { lat: 52.1, lng: 4.3 },
    name: 'Student Center',
    placeId: 'google-place-1',
    type: 'google',
  },
  planningTips: 'Bring the banner',
  questions: [
    {
      description: 'Dietary needs',
      id: 'question-1',
      registrationOptionId: 'participant-option',
      required: true,
      sortOrder: 2,
      title: 'Do you have dietary requirements?',
    },
  ],
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: 48,
      closeRegistrationOffset: 12,
      description: 'Organizer description',
      esnCardDiscountedPrice: 800,
      id: 'organizer-option',
      isPaid: true,
      openRegistrationOffset: 240,
      organizingRegistration: true,
      price: 1000,
      refundFeesOnCancellation: false,
      registeredDescription: 'Organizer confirmation',
      registrationMode: 'application',
      roleIds: ['organizer-role'],
      roles: [{ id: 'organizer-role', name: 'Organizer' }],
      spots: 5,
      stripeTaxRateId: 'txr-organizer',
      title: 'Organizers',
      transferDeadlineHoursBeforeStart: 72,
    },
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 2,
      description: null,
      esnCardDiscountedPrice: null,
      id: 'participant-option',
      isPaid: false,
      openRegistrationOffset: 168,
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs',
      roleIds: ['member-role'],
      roles: [{ id: 'member-role', name: 'Member' }],
      spots: 30,
      stripeTaxRateId: null,
      title: 'Participants',
      transferDeadlineHoursBeforeStart: null,
    },
  ],
  simpleModeEnabled: false,
  title: 'Weekend trip',
  unlisted: true,
});

describe('platform template editor graph mapping', () => {
  it('round-trips every supported mode and multi-option add-on mapping', () => {
    const loadResult = platformTemplateRecordToFormModel(completeTemplate());

    expect('model' in loadResult).toBe(true);
    if (!('model' in loadResult)) return;
    expect(loadResult.model.registrationOptions[1]?.registrationMode).toBe(
      'fcfs',
    );
    expect(loadResult.model.addOns[0]?.registrationOptions).toEqual([
      {
        includedQuantity: 2,
        optionalPurchaseQuantity: 0,
        registrationOptionKey: 'organizer-option',
      },
      {
        includedQuantity: 0,
        optionalPurchaseQuantity: 1,
        registrationOptionKey: 'participant-option',
      },
    ]);

    const payload = platformTemplateFormToPayload(loadResult.model, true);

    expect(payload.registrationOptions).toEqual([
      {
        cancellationDeadlineHoursBeforeStart: 48,
        closeRegistrationOffset: 12,
        description: 'Organizer description',
        esnCardDiscountedPrice: 800,
        id: 'organizer-option',
        isPaid: true,
        key: 'organizer-option',
        openRegistrationOffset: 240,
        organizingRegistration: true,
        price: 1000,
        refundFeesOnCancellation: false,
        registeredDescription: 'Organizer confirmation',
        registrationMode: 'application',
        roleIds: ['organizer-role'],
        spots: 5,
        stripeTaxRateId: 'txr-organizer',
        title: 'Organizers',
        transferDeadlineHoursBeforeStart: 72,
      },
      {
        cancellationDeadlineHoursBeforeStart: null,
        closeRegistrationOffset: 2,
        description: null,
        esnCardDiscountedPrice: null,
        id: 'participant-option',
        isPaid: false,
        key: 'participant-option',
        openRegistrationOffset: 168,
        organizingRegistration: false,
        price: 0,
        refundFeesOnCancellation: null,
        registeredDescription: null,
        registrationMode: 'fcfs',
        roleIds: ['member-role'],
        spots: 30,
        stripeTaxRateId: null,
        title: 'Participants',
        transferDeadlineHoursBeforeStart: null,
      },
    ]);
    expect(payload.addOns[0]).toEqual({
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: true,
      allowPurchaseDuringRegistration: false,
      description: 'Add-on description',
      id: 'addon-1',
      isPaid: true,
      key: 'addon-1',
      maxQuantityPerUser: 3,
      price: 450,
      registrationOptions: [
        {
          includedQuantity: 2,
          optionalPurchaseQuantity: 0,
          registrationOptionKey: 'organizer-option',
        },
        {
          includedQuantity: 0,
          optionalPurchaseQuantity: 1,
          registrationOptionKey: 'participant-option',
        },
      ],
      stripeTaxRateId: 'txr-addon',
      title: 'Dinner',
      totalAvailableQuantity: 40,
    });
    expect(payload.questions[0]).toEqual({
      description: 'Dietary needs',
      id: 'question-1',
      key: 'question-1',
      registrationOptionKey: 'participant-option',
      required: true,
      sortOrder: 2,
      title: 'Do you have dietary requirements?',
    });
    expect({
      categoryId: payload.categoryId,
      description: payload.description,
      icon: payload.icon,
      planningTips: payload.planningTips,
      simpleModeEnabled: payload.simpleModeEnabled,
      title: payload.title,
      unlisted: payload.unlisted,
    }).toEqual({
      categoryId: 'category-1',
      description: '<p>Template description</p>',
      icon: { iconColor: 4, iconName: 'campground:fas' },
      planningTips: 'Bring the banner',
      simpleModeEnabled: false,
      title: 'Weekend trip',
      unlisted: true,
    });
  });

  it('explains why a random-allocation template cannot be edited', () => {
    const source = completeTemplate();
    const legacyRandomTemplate: TemplateGraphRecord = {
      ...source,
      registrationOptions: source.registrationOptions.map((option, index) =>
        index === 1 ? { ...option, registrationMode: 'random' } : option,
      ),
    };

    expect(platformTemplateRecordToFormModel(legacyRandomTemplate)).toEqual({
      error:
        'Random allocation is unavailable. Create a new template using First come, first served or Manual approval instead.',
    });
  });

  it('fails only when a persisted graph reference is genuinely corrupt', () => {
    const source = completeTemplate();
    const corrupt: TemplateGraphRecord = {
      ...source,
      questions: source.questions.map((question) => ({
        ...question,
        registrationOptionId: 'missing-option',
      })),
    };

    expect(platformTemplateRecordToFormModel(corrupt)).toEqual({
      error:
        'This template graph contains a registration-option reference that does not belong to the template.',
    });
  });

  it('uses the canonical persisted-shape guard before switching to simple mode', () => {
    const source = completeTemplate();
    const [organizerOption, participantOption] = source.registrationOptions;
    if (!organizerOption || !participantOption) {
      throw new Error('Expected two registration options');
    }
    const currentOptions = [organizerOption, participantOption];
    const incompatiblePersisted = {
      ...source,
      registrationOptions: [
        ...currentOptions,
        {
          ...participantOption,
          id: 'extra-participant-option',
        },
      ],
      simpleModeEnabled: false,
    };

    expect(
      platformTemplateModeTransitionIssue(
        'simple',
        incompatiblePersisted,
        currentOptions,
      ),
    ).toContain('Save the compatible advanced changes first');
    expect(
      platformTemplateModeTransitionIssue(
        'advanced',
        incompatiblePersisted,
        currentOptions,
      ),
    ).toBeNull();
    expect(
      platformTemplateModeTransitionIssue('simple', source, [
        organizerOption,
        { ...participantOption, organizingRegistration: true },
      ]),
    ).toContain('exactly one organizing and one non-organizing option');
  });

  it('reuses the shared graph validation and confirms mode changes', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-template-editor.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-template-editor.component.html',
      ),
      'utf8',
    );

    expect(source).toContain(
      'apply(registration, templateGraphRegistrationOptionFormSchema)',
    );
    expect(source).toContain('apply(addOn, templateGraphAddonFormSchema)');
    expect(source).toContain(
      'applyEach(template.questions, templateGraphQuestionFormSchema)',
    );
    expect(source).toContain('TemplateModeConfirmationDialogComponent');
    expect(source).toContain('persistedAdvancedToSimpleModeIssue');
    expect(source).toContain('globalAdmin.tenants.findOne.queryOptions');
    expect(source).toContain(
      'disabled(registration.isPaid, () => !this.stripeConnected())',
    );
    expect(source).toContain(
      'disabled(addOn.isPaid, () => !this.stripeConnected())',
    );
    expect(source).toContain('resetTemplateGraphPayments');
    expect(template).toContain("requestMode('simple')");
    expect(template).toContain("requestMode('advanced')");
    expect(template).toContain('status could not be loaded');
    expect(template.match(/<app-currency-amount-input/g)?.length).toBe(3);
    expect(template.match(/\[minimumMinorUnits\]="1"/g)?.length).toBe(2);
    expect(template).toContain('[currencyCode]="targetTenantCurrency()"');
    expect(template).not.toContain('(cents)');
    expect(template).toContain(
      'Previously selected category (no longer available)',
    );
    expect(template).toContain(
      'Previously selected organization role (no longer available)',
    );
    expect(template.match(/Previously selected tax rate/g)?.length).toBe(2);
    expect(template).not.toContain('{{ selectedCategoryId }}');
    expect(template).not.toContain('{{ missingRoleId }}');
    expect(template).not.toContain('{{ selectedTaxRateId }}');
    expect(source).not.toContain('getErrorMessage');
    expect(template).not.toContain(
      '[formField]="templateForm.simpleModeEnabled"',
    );
  });

  it('reinitializes a new template when the organization changes', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-template-editor.component.ts',
      ),
      'utf8',
    );

    expect(source).toContain(
      'private readonly initializedNewTemplateTenantId = signal<null | string>(null)',
    );
    expect(source).toContain(
      'this.initializedNewTemplateTenantId() === tenantId',
    );
    expect(source).toContain(
      'this.initializedNewTemplateTenantId.set(tenantId)',
    );
    expect(source).toContain('const model = createPlatformTemplateFormModel()');
    expect(source).not.toContain('initializedNewTemplate = signal(false)');
  });
});
