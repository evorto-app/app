import '@angular/compiler';
import { Component, input } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  createRpcQueryFilter,
  createRpcQueryKey,
} from '@heddendorp/effect-angular-query';
import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
} from '@shared/registration-quantity-limits';
import { GlobalAdminTenantRecord } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import {
  type PlatformEventDetailRecord,
  type PlatformEventFormOptionsRecord,
} from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';
import {
  provideTanStackQuery,
  QueryClient,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { type Schema } from 'effect';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';
import {
  PlatformEventDetailComponent,
  PlatformEventDetailOperations,
} from './platform-event-detail.component';
import {
  platformEventAddOnQuantityLimitIssue,
  platformEventAddonTypeLimitIssue,
} from './platform-event-detail.component';
import {
  platformEventAddOnAvailabilityIssue,
  platformEventAddOnMappingIssue,
  platformEventAddOnStockIssue,
  platformEventDiscountedPriceIssue,
  platformEventEditorIsReadOnly,
  platformEventIntegerIssue,
  platformEventPaidAddOnPriceIssue,
  platformEventPaidRegistrationPriceIssue,
  platformEventPaidTaxRateIssue,
  platformEventQuestionOptionIssue,
  platformEventRegistrationWindowHasValidOrder,
  platformEventSimpleModeIssue,
  platformEventTitleIssue,
} from './platform-event-detail.component';

describe('platform event registration-mode compatibility', () => {
  it('keeps every non-draft event editor read-only', () => {
    expect(platformEventEditorIsReadOnly('DRAFT')).toBe(false);
    expect(platformEventEditorIsReadOnly('PENDING_REVIEW')).toBe(true);
    expect(platformEventEditorIsReadOnly('APPROVED')).toBe(true);

    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );
    expect(template).toContain(
      '[disabled]="eventEditorIsReadOnly(event.status)"',
    );
    expect(template).toContain(
      '[attr.inert]="eventEditorIsReadOnly(event.status) ? \'\' : null"',
    );
    expect(template).toContain('Return this event to draft before editing it.');
  });

  it('keeps simple events to one organizer and one participant registration', () => {
    const validOptions = [
      { organizingRegistration: true },
      { organizingRegistration: false },
    ];

    expect(platformEventSimpleModeIssue(true, validOptions)).toBeNull();
    expect(
      platformEventSimpleModeIssue(true, [
        { organizingRegistration: true },
        { organizingRegistration: true },
      ]),
    ).toBe(
      'Simple events need one organizer registration and one participant registration.',
    );
    expect(
      platformEventSimpleModeIssue(false, [
        { organizingRegistration: true },
        { organizingRegistration: true },
      ]),
    ).toBeNull();

    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );
    expect(template).toContain('simpleModeIssue() !== null');
    expect(template).toContain('@if (simpleModeIssue(); as error)');
  });

  it('keeps event editing explicit and fail-closed while dependencies load', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(template).toContain('Update registration mode');
    expect(template).not.toContain('· {{ option.id }}');
    expect(template).not.toContain('errorMessage(');
    expect(template).not.toContain('getErrorMessage(');
    expect(source).toContain(
      "getErrorMessage(error, fallback, ['RpcBadRequestError'])",
    );
    expect(template).not.toContain('<mat-option value="random"');
    expect(template).toContain('event.simpleModeEnabled');
    expect(source).toContain('globalAdmin.tenants.findOne.queryOptions');
    expect(source).toContain('resetPlatformEventGraphPayments');
    expect(template).toContain('[disabled]="!paymentsConfigured()"');
    expect(template).toContain('status could not be loaded');
    expect(template).toContain('Event editing settings could not be loaded');
    expect(template).toContain('(click)="formOptionsQuery.refetch()"');
    expect(template).toContain('!formOptionsReady()');
  });

  it('blocks invalid target-timezone registration windows instead of saving stale instants', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(source).toContain('invalidRegistrationWindowFields');
    expect(source).toContain('new Set([...fields, fieldKey])');
    expect(template).toContain('invalidRegistrationWindowFields().size > 0');
    expect(template).toContain('Enter a valid time in');
    expect(template).not.toContain('| date:');
  });

  it('blocks reversed event and registration windows with field-level guidance', () => {
    expect(
      platformEventRegistrationWindowHasValidOrder({
        closeRegistrationTime: '2026-07-14T10:00:00.000Z',
        openRegistrationTime: '2026-07-14T11:00:00.000Z',
      }),
    ).toBe(false);
    expect(
      platformEventRegistrationWindowHasValidOrder({
        closeRegistrationTime: '2026-07-14T11:00:00.000Z',
        openRegistrationTime: '2026-07-14T11:00:00.000Z',
      }),
    ).toBe(true);

    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(source).toContain('validate(event.end');
    expect(source).toContain('hasInvalidRegistrationWindowOrder');
    expect(source).toContain('The event must end after it starts.');
    expect(template).toContain('Registration must close at or after it opens.');
    expect(template).toContain('hasInvalidRegistrationWindowOrder()');
  });

  it('accepts ordinary currency amounts while retaining minor-unit graph values', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(source).toContain('majorCurrencyInputToMinorUnits');
    expect(source).toContain('currencyAmountErrors().size > 0');
    expect(template).toMatch(
      /\[value\]="\s*minorUnitsToMajorCurrencyInput\(option\.price\)\s*"/,
    );
    expect(template).toContain('(input)="setAddOnPrice(addOnIndex, $event)"');
    expect(template).toContain('targetTenantCurrency()');
    expect(template).not.toContain('Price in minor units');
  });

  it('requires paid registration and add-on prices to contain at least one minor unit', () => {
    expect(platformEventPaidRegistrationPriceIssue(false, 0)).toBeNull();
    expect(platformEventPaidRegistrationPriceIssue(true, 0)).toBe(
      'Paid registrations must cost at least 0.01.',
    );
    expect(platformEventPaidRegistrationPriceIssue(true, 1)).toBeNull();
    expect(platformEventPaidAddOnPriceIssue(false, 0)).toBeNull();
    expect(platformEventPaidAddOnPriceIssue(true, 0)).toBe(
      'Paid add-ons must cost at least 0.01.',
    );
    expect(platformEventPaidAddOnPriceIssue(true, 1)).toBeNull();
    expect(platformEventDiscountedPriceIssue(true, 1000, 2000, true)).toBe(
      'Discounted price cannot exceed the base price.',
    );
    expect(platformEventDiscountedPriceIssue(true, 1000, 900, true)).toBeNull();
    expect(platformEventDiscountedPriceIssue(true, 1000, 900, false)).toBe(
      'Remove the ESNcard price because ESNcard discounts are disabled for this organization.',
    );

    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(source).toContain(
      'platformEventPaidRegistrationPriceIssue(option.isPaid, option.price)',
    );
    expect(source).toContain(
      'platformEventPaidAddOnPriceIssue(addOn.isPaid, addOn.price)',
    );
    expect(source).toContain('platformEventDiscountedPriceIssue(');
    expect(template).toMatch(
      /<mat-label>\s*Price[\s\S]*?min="0\.01"[\s\S]*?setOptionPrice\(optionIndex, 'price', \$event\)/,
    );
  });

  it('treats blank required numeric edits as invalid instead of retaining stale values', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(platformEventIntegerIssue(NaN, 0)).toBe(
      'Enter a whole number of zero or more.',
    );
    expect(platformEventIntegerIssue(0, 0)).toBeNull();
    expect(platformEventIntegerIssue(0, 1)).toBe(
      'Enter a whole number of at least one.',
    );
    expect(source).toContain('value === null ? NaN : value');
    expect(source).toContain('this.graphHasIssues()');
    expect(template).toContain('graphHasIssues()');
  });

  it('offers only named organization-role checkboxes', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(template).not.toContain('<mat-label>Role IDs</mat-label>');
    expect(template).not.toContain('setOptionRoleIds');
    expect(template).toContain('{{ role.name }}');
    expect(source).not.toContain('setOptionRoleIds');
  });

  it('allows optional-only add-on mappings and rejects an empty mapping', () => {
    const addOn = { maxQuantityPerUser: 2, totalAvailableQuantity: 3 };
    expect(platformEventAddOnMappingIssue(addOn, 0, 2)).toBeNull();
    expect(platformEventAddOnMappingIssue(addOn, 1, 0)).toBeNull();
    expect(platformEventAddOnMappingIssue(addOn, 0, 0)).toBe(
      'Include or offer at least one unit.',
    );
    expect(platformEventAddOnMappingIssue(addOn, 2, 2)).toBe(
      'Included and optional quantities cannot exceed available stock.',
    );
    expect(platformEventAddOnMappingIssue(addOn, 0, 3)).toBe(
      'Optional quantity cannot exceed the maximum per attendee.',
    );
    expect(
      platformEventAddOnAvailabilityIssue({
        allowPurchaseBeforeEvent: false,
        allowPurchaseDuringEvent: false,
        allowPurchaseDuringRegistration: false,
      }),
    ).toBe('Choose when this add-on is available.');
    expect(
      platformEventAddOnStockIssue({
        maxQuantityPerUser: 4,
        totalAvailableQuantity: 3,
      }),
    ).toBe('Maximum per attendee cannot exceed available stock.');
    const taxRateIds = new Set(['txr_1']);
    expect(platformEventPaidTaxRateIssue(true, null, taxRateIds)).toBe(
      'Select an inclusive tax rate for this paid item.',
    );
    expect(
      platformEventPaidTaxRateIssue(true, 'txr_inactive', taxRateIds),
    ).toBe(
      'This tax rate is no longer available. Choose another inclusive tax rate.',
    );
    expect(platformEventPaidTaxRateIssue(true, 'txr_1', taxRateIds)).toBeNull();

    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(template).toMatch(/<mat-label>Included<\/mat-label>[\s\S]*?min="0"/);
    expect(template).toContain('addOnMappingIssue(');
    expect(template).toContain('addOnAvailabilityIssue(addOn)');
    expect(template).toContain('paidTaxRateIssue(');
  });

  it('explains blank graph titles and invalid question targets before saving', () => {
    const registrationOptionIds = new Set(['option-1']);

    expect(platformEventTitleIssue('  ', 'registration option')).toBe(
      'Enter a registration option title.',
    );
    expect(platformEventTitleIssue('Dinner', 'add-on')).toBeNull();
    expect(
      platformEventQuestionOptionIssue('missing-option', registrationOptionIds),
    ).toBe('Select a registration option for this question.');
    expect(
      platformEventQuestionOptionIssue('option-1', registrationOptionIds),
    ).toBeNull();

    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(source).toContain('platformEventGraphHasIssues');
    expect(template).toContain(
      'titleIssue(option.title, "registration option")',
    );
    expect(template).toContain('questionOptionIssue(');
  });
  it('accepts platform add-on caps and rejects cap plus one', () => {
    const addOn = {
      maxQuantityPerUser: MAX_REGISTRATION_ADDON_QUANTITY,
      totalAvailableQuantity: 100,
    };

    expect(
      platformEventAddOnQuantityLimitIssue(MAX_REGISTRATION_ADDON_QUANTITY),
    ).toBeNull();
    expect(
      platformEventAddOnQuantityLimitIssue(MAX_REGISTRATION_ADDON_QUANTITY + 1),
    ).toBe(
      `Maximum per attendee cannot exceed ${MAX_REGISTRATION_ADDON_QUANTITY}.`,
    );
    expect(
      platformEventAddOnMappingIssue(addOn, MAX_REGISTRATION_ADDON_QUANTITY, 0),
    ).toBeNull();
    expect(
      platformEventAddOnMappingIssue(addOn, MAX_REGISTRATION_ADDON_QUANTITY, 1),
    ).toBe(
      `Included and optional quantities cannot exceed ${MAX_REGISTRATION_ADDON_QUANTITY} per sign-up.`,
    );
    expect(
      platformEventAddonTypeLimitIssue(
        Array.from({ length: MAX_EVENT_ADDON_TYPES }),
      ),
    ).toBeNull();
    expect(
      platformEventAddonTypeLimitIssue(
        Array.from({ length: MAX_EVENT_ADDON_TYPES + 1 }),
      ),
    ).toBe(`Add no more than ${MAX_EVENT_ADDON_TYPES} different add-ons.`);

    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );
    expect(
      template.match(/\[max\]="maxRegistrationAddonQuantity"/g)?.length,
    ).toBe(3);
    expect(template).toContain(
      '[disabled]="graph.addOns.length >= maxEventAddonTypes"',
    );
    expect(template).toContain('addOnTypeLimitIssue(graph.addOns)');
  });
});

type ListingVariables = Parameters<
  NonNullable<
    ReturnType<PlatformEventDetailOperations['updateListing']>['mutationFn']
  >
>[0];

type ReviewEventVariables = Parameters<
  NonNullable<ReturnType<PlatformEventDetailOperations['review']>['mutationFn']>
>[0];
type SubmitReviewVariables = Parameters<
  NonNullable<
    ReturnType<PlatformEventDetailOperations['submitForReview']>['mutationFn']
  >
>[0];
type UpdateGraphVariables = Parameters<
  NonNullable<ReturnType<PlatformEventDetailOperations['update']>['mutationFn']>
>[0];
@Component({
  selector: 'app-platform-tenant-page-header',
  template: '',
})
class PlatformEventGraphSaveHeaderStub {
  readonly tenantId = input.required<string>();
  readonly title = input.required<string>();
}

const graphSaveEventRecord = (): PlatformEventDetailRecord => ({
  addOns: [
    {
      allowMultiple: false,
      allowPurchaseBeforeEvent: false,
      allowPurchaseDuringEvent: false,
      allowPurchaseDuringRegistration: true,
      description: 'Keep the included equipment',
      id: 'addon-1',
      isPaid: false,
      maxQuantityPerUser: 1,
      price: 0,
      registrationOptions: [
        {
          includedQuantity: 1,
          optionalPurchaseQuantity: 0,
          registrationOptionId: 'option-1',
        },
      ],
      stripeTaxRateId: null,
      title: 'Equipment',
      totalAvailableQuantity: 20,
    },
  ],
  creator: {
    email: 'alex@example.test',
    firstName: 'Alex',
    id: 'user-1',
    lastName: 'Able',
  },
  description: 'Original event description',
  end: '2026-09-20T12:00:00.000Z',
  icon: { iconColor: 0, iconName: 'calendar' },
  id: 'event-1',
  location: null,
  questions: [
    {
      description: 'Keep this question',
      id: 'question-1',
      registrationOptionId: 'option-1',
      required: true,
      sortOrder: 0,
      title: 'Equipment size',
    },
  ],
  registrationCount: 0,
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: 12,
      checkedInSpots: 0,
      closeRegistrationTime: '2026-09-20T09:00:00.000Z',
      confirmedSpots: 0,
      description: 'Participant registration',
      esnCardDiscountedPrice: null,
      id: 'option-1',
      isPaid: false,
      openRegistrationTime: '2026-09-01T10:00:00.000Z',
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: 'Your equipment is included',
      registrationMode: 'fcfs',
      roleIds: ['role-1'],
      spots: 20,
      stripeTaxRateId: null,
      title: 'Participant',
      transferDeadlineHoursBeforeStart: 24,
    },
  ],
  reviewedAt: null,
  simpleModeEnabled: false,
  start: '2026-09-20T10:00:00.000Z',
  status: 'DRAFT',
  statusComment: null,
  title: 'Original event title',
  unlisted: true,
});

const graphSaveFormOptions: Schema.Schema.Type<
  typeof PlatformEventFormOptionsRecord
> = {
  creators: [graphSaveEventRecord().creator],
  esnCardEnabled: false,
  roles: [{ id: 'role-1', name: 'Members' }],
  taxRates: [],
  templates: [],
  timezone: 'Europe/Berlin',
};

const graphSaveTenant = new GlobalAdminTenantRecord({
  currency: 'EUR',
  domain: 'tenant.example.test',
  id: 'tenant-1',
  name: 'Test organization',
  paymentsConfigured: false,
  theme: 'evorto',
  timezone: 'Europe/Berlin',
});

const graphSaveUncertainMessage =
  'The event update could not be confirmed. Load this page again and check the current event before trying again.';
const graphSaveConfirmedReadFailure =
  'The event was updated, but the latest event information could not be loaded. Load this page again to check the saved details.';
const graphSaveQueryKey = createRpcQueryKey(['platform', 'events', 'findOne'], {
  input: { eventId: 'event-1', targetTenantId: 'tenant-1' },
  type: 'query',
});
const graphSaveChoicesKey = createRpcQueryKey(
  ['platform', 'events', 'formOptions'],
  {
    input: { targetTenantId: 'tenant-1' },
    type: 'query',
  },
);

const heldGraphSaveResult = <T>() => {
  let complete: ((value: T) => void) | undefined;
  // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- Angular browser tests use the ES2022 library.
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (!complete) throw new Error('Expected a registered result owner');
      complete(value);
    },
  };
};

const runGraphSaveScenario = async (
  run: () => Promise<void>,
  cleanups: readonly ((() => Promise<unknown>) | (() => void))[],
) => {
  const failures: unknown[] = [];
  try {
    await run();
  } catch (error) {
    failures.push(error);
  } finally {
    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      'Platform event graph-save scenario failed',
      { cause: failures[0] },
    );
  }
};

describe('PlatformEventDetailComponent graph-save outcomes', () => {
  let record = graphSaveEventRecord();
  let queryClient: QueryClient;
  let acquiredQueryClient: QueryClient | undefined;
  let fixture: ComponentFixture<PlatformEventDetailComponent>;
  let acquiredFixture:
    ComponentFixture<PlatformEventDetailComponent> | undefined;
  let root: HTMLElement;
  const loadEvent = vi.fn(async () => record);
  const loadChoices = vi.fn(async () => graphSaveFormOptions);
  const updateEvent =
    vi.fn<
      (input: UpdateGraphVariables) => Promise<PlatformEventDetailRecord>
    >();
  const changeListing =
    vi.fn<(input: ListingVariables) => Promise<PlatformEventDetailRecord>>();
  const submitReview =
    vi.fn<
      (input: SubmitReviewVariables) => Promise<PlatformEventDetailRecord>
    >();
  const reviewEvent =
    vi.fn<
      (input: ReviewEventVariables) => Promise<PlatformEventDetailRecord>
    >();
  const showError = vi.fn<(message: string) => void>();
  const showSuccess = vi.fn<(message: string) => void>();

  beforeEach(async () => {
    record = graphSaveEventRecord();
    loadEvent.mockReset().mockImplementation(async () => record);
    loadChoices.mockReset().mockResolvedValue(graphSaveFormOptions);
    updateEvent.mockReset().mockImplementation(async () => record);
    changeListing.mockReset().mockImplementation(async () => record);
    submitReview.mockReset().mockImplementation(async () => record);
    reviewEvent.mockReset().mockImplementation(async () => record);
    showError.mockReset();
    showSuccess.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    acquiredQueryClient = queryClient;
    TestBed.overrideComponent(PlatformEventDetailComponent, {
      add: { imports: [PlatformEventGraphSaveHeaderStub] },
      remove: { imports: [PlatformTenantPageHeaderComponent] },
    });
    await TestBed.configureTestingModule({
      imports: [PlatformEventDetailComponent],
      providers: [
        provideTanStackQuery(queryClient),
        provideRouter([]),
        { provide: NotificationService, useValue: { showError, showSuccess } },
        {
          provide: PlatformEventDetailOperations,
          useValue: {
            eventFilter: () => createRpcQueryFilter(['platform', 'events']),
            findOne: () => ({
              queryFn: loadEvent,
              queryKey: graphSaveQueryKey,
            }),
            formOptions: () => ({
              queryFn: loadChoices,
              queryKey: graphSaveChoicesKey,
            }),
            review: () => ({
              mutationFn: reviewEvent,
              mutationKey: ['platform-event-detail', 'review'],
            }),
            submitForReview: () => ({
              mutationFn: submitReview,
              mutationKey: ['platform-event-detail', 'submit'],
            }),
            tenant: () => ({
              queryFn: async () => graphSaveTenant,
              queryKey: ['platform-event-tenant', 'tenant-1'],
            }),
            update: () => ({
              mutationFn: updateEvent,
              mutationKey: ['platform-event-detail', 'update'],
            }),
            updateListing: () => ({
              mutationFn: changeListing,
              mutationKey: ['platform-event-detail', 'listing'],
            }),
          },
        },
      ],
    }).compileComponents();
  });

  const drainSave = async () => {
    const currentFixture = acquiredFixture;
    if (!currentFixture) return;
    await vi.waitFor(() => {
      currentFixture.detectChanges();
      expect(currentFixture.componentInstance['editForm']().submitting()).toBe(
        false,
      );
    });
    await currentFixture.whenStable();
  };

  afterEach(async () => {
    const queryClientToClear = acquiredQueryClient;
    acquiredQueryClient = undefined;
    try {
      await runGraphSaveScenario(drainSave, [
        () => {
          TestBed.resetTestingModule();
        },
        () => queryClientToClear?.clear(),
      ]);
    } finally {
      acquiredFixture = undefined;
    }
  });

  const field = (label: string): HTMLInputElement | HTMLTextAreaElement => {
    const wrapper = [...root.querySelectorAll('mat-form-field')].find(
      (candidate) =>
        candidate.querySelector('mat-label')?.textContent?.trim() === label,
    );
    const control = wrapper?.querySelector('input, textarea');
    if (!(
      control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement
    )) {
      throw new TypeError(`Expected field ${label}`);
    }
    return control;
  };

  const button = (label: string): HTMLButtonElement => {
    const result = [...root.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!result) throw new Error(`Expected button ${label}`);
    return result;
  };

  const enter = (label: string, value: string) => {
    const control = field(label);
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  };

  const entries = () =>
    JSON.stringify({
      actionReason: field('Action reason').value,
      form: fixture.componentInstance['editForm']().value(),
      graph: fixture.componentInstance['graphModel'](),
      rendered: {
        description: field('Description').value,
        end: field('End').value,
        reason: field('Update reason').value,
        start: field('Start').value,
        title: field('Title').value,
      },
    });

  const render = async () => {
    fixture = TestBed.createComponent(PlatformEventDetailComponent);
    acquiredFixture = fixture;
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.detectChanges();
    const element: unknown = fixture.nativeElement;
    if (!(element instanceof HTMLElement))
      throw new Error('Expected rendered event element');
    root = element;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(field('Title').value).toBe(record.title);
      expect(loadChoices).toHaveBeenCalledOnce();
    });
    enter('Action reason', '  Explain the action  ');
    enter('Title', 'Submitted event title');
    enter('Description', 'Submitted event description');
    enter('Update reason', 'Explain the edited details');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button('Save draft details').disabled).toBe(false);
    });
  };

  const invokeSave = () => {
    const form = root.querySelector('form');
    if (!form) throw new Error('Expected event form');
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  };

  const expectSinglePayload = () => {
    const original = graphSaveEventRecord();
    expect(
      updateEvent.mock.calls.map(([payload]) => JSON.stringify(payload)),
    ).toEqual([
      JSON.stringify({
        addOns: original.addOns,
        description: 'Submitted event description',
        end: original.end,
        eventId: 'event-1',
        icon: { iconColor: 0, iconName: 'calendar' },
        location: null,
        questions: original.questions,
        reason: 'Explain the edited details',
        registrationOptions: original.registrationOptions,
        start: original.start,
        targetTenantId: 'tenant-1',
        title: 'Submitted event title',
      }),
    ]);
    expect(changeListing).not.toHaveBeenCalled();
    expect(submitReview).not.toHaveBeenCalled();
    expect(reviewEvent).not.toHaveBeenCalled();
  };

  const expectMessage = async (message: string) => {
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(showError).toHaveBeenLastCalledWith(message);
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(
        message,
      );
    });
    expect(showSuccess).not.toHaveBeenCalled();
  };

  const expectAllActionsBlocked = () => {
    expect(fixture.componentInstance['editForm']().submitting()).toBe(true);
    for (const label of [
      'Save draft details',
      'Submit for review',
      'Make listed',
    ]) {
      expect(button(label).disabled).toBe(true);
    }
  };

  const attemptOtherActions = () => {
    invokeSave();
    for (const label of ['Submit for review', 'Make listed']) {
      button(label).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    fixture.detectChanges();
  };

  it.each([
    {
      error: new Error(
        'The test-local change completed but its response was lost.',
      ),
      label: 'a lost response',
    },
    {
      error: new RpcInternalServerError({ message: 'Private database detail' }),
      label: 'an internal RPC failure',
    },
  ])('keeps the graph save unconfirmed after $label', async ({ error }) => {
    await render();
    const entered = entries();
    let simulatedChange = false;
    updateEvent.mockImplementationOnce(async () => {
      simulatedChange = true;
      throw error;
    });
    invokeSave();
    await expectMessage(graphSaveUncertainMessage);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button('Save draft details').disabled).toBe(false);
    });
    expect(simulatedChange).toBe(true);
    expect(entries()).toBe(entered);
    expectSinglePayload();
    expect(loadEvent).toHaveBeenCalledOnce();
    expect(loadChoices).toHaveBeenCalledOnce();
    expect(root.textContent).not.toContain('response was lost');
    expect(root.textContent).not.toContain('Private database detail');
  });

  it('reports a confirmed graph save when the explicit event read fails and retains edits after a read retry', async () => {
    await render();
    const entered = entries();
    loadEvent
      .mockResolvedValueOnce(record)
      .mockRejectedValueOnce(new Error('Detail read failed'));
    invokeSave();
    await expectMessage(graphSaveConfirmedReadFailure);
    expect(loadEvent).toHaveBeenCalledTimes(3);
    expect(loadChoices).toHaveBeenCalledTimes(2);
    expectSinglePayload();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button('Try again').disabled).toBe(false);
    });
    button('Try again').click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button('Save draft details').disabled).toBe(false);
      expect(entries()).toBe(entered);
    });
    expect(loadEvent).toHaveBeenCalledTimes(4);
    expectSinglePayload();
  });

  it('keeps graph save and lifecycle actions blocked through mutation and follow-up reads while preserving newer edits', async () => {
    await render();
    const mutation = heldGraphSaveResult<PlatformEventDetailRecord>();
    const detail = heldGraphSaveResult<PlatformEventDetailRecord>();
    updateEvent.mockReturnValueOnce(mutation.promise);
    loadEvent.mockResolvedValueOnce(record).mockReturnValueOnce(detail.promise);
    await runGraphSaveScenario(async () => {
      invokeSave();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(updateEvent).toHaveBeenCalledOnce();
        expectAllActionsBlocked();
      });
      attemptOtherActions();
      expectSinglePayload();
      enter('Action reason', 'Newer unsent action reason');
      enter('Title', 'Newer unsent title');
      enter('Update reason', 'Newer unsent update reason');
      const newerEntries = entries();
      mutation.resolve(record);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(loadEvent).toHaveBeenCalledTimes(3);
        expectAllActionsBlocked();
      });
      attemptOtherActions();
      expectSinglePayload();
      detail.resolve(record);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(showSuccess).toHaveBeenCalledExactlyOnceWith('Event updated');
        expect(button('Save draft details').disabled).toBe(false);
        expect(entries()).toBe(newerEntries);
      });
      expectSinglePayload();
      expect(showError).not.toHaveBeenCalled();
    }, [
      () => mutation.resolve(record),
      () => detail.resolve(record),
      drainSave,
    ]);
  });

  it('drains an active sibling after another graph follow-up read fails, then still reads the event', async () => {
    await render();
    const entered = entries();
    const sibling = heldGraphSaveResult<string[]>();
    const loadSibling = vi.fn(async () => ['loaded']);
    const observer = new QueryObserver(queryClient, {
      queryFn: loadSibling,
      queryKey: createRpcQueryKey(['platform', 'events', 'list'], {
        input: { targetTenantId: 'tenant-1' },
        type: 'query',
      }),
    });
    let siblingStatus = 'pending';
    const unsubscribe = observer.subscribe((result) => {
      siblingStatus = result.status;
    });
    await runGraphSaveScenario(async () => {
      await vi.waitFor(() => expect(siblingStatus).toBe('success'));
      loadChoices.mockRejectedValueOnce(new Error('Choices failed first'));
      loadSibling.mockReturnValueOnce(sibling.promise);
      invokeSave();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(loadSibling).toHaveBeenCalledTimes(2);
        expect(queryClient.getQueryState(graphSaveChoicesKey)?.status).toBe(
          'error',
        );
        expectAllActionsBlocked();
        expect(button('Try again').disabled).toBe(true);
      });
      expect(loadEvent).toHaveBeenCalledTimes(2);
      expect(showError).not.toHaveBeenCalled();
      expect(showSuccess).not.toHaveBeenCalled();
      attemptOtherActions();
      expectSinglePayload();
      sibling.resolve(['loaded again']);
      await expectMessage(graphSaveConfirmedReadFailure);
      expect(root.textContent).not.toContain('Nothing changed.');
      expect(loadEvent).toHaveBeenCalledTimes(3);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(button('Try again').disabled).toBe(false);
      });
      button('Try again').click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(button('Save draft details').disabled).toBe(false);
        expect(entries()).toBe(entered);
      });
      expectSinglePayload();
    }, [() => sibling.resolve(['released']), drainSave, unsubscribe]);
  });

  it('does not await an inactive matching read that graph-save invalidation does not refetch', async () => {
    await render();
    const inactive = heldGraphSaveResult<string[]>();
    const inactiveKey = createRpcQueryKey(['platform', 'events', 'list'], {
      input: { targetTenantId: 'tenant-2' },
      type: 'query',
    });
    const loadInactive = vi.fn(() => inactive.promise);
    const inactiveRead = queryClient.fetchQuery({
      queryFn: loadInactive,
      queryKey: inactiveKey,
    });
    await runGraphSaveScenario(async () => {
      expect(
        queryClient
          .getQueryCache()
          .find({ exact: true, queryKey: inactiveKey })
          ?.isActive(),
      ).toBe(false);
      expect(queryClient.getQueryState(inactiveKey)?.fetchStatus).toBe(
        'fetching',
      );
      invokeSave();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(showSuccess).toHaveBeenCalledExactlyOnceWith('Event updated');
        expect(button('Save draft details').disabled).toBe(false);
      });
      expect(queryClient.getQueryState(inactiveKey)?.fetchStatus).toBe(
        'fetching',
      );
      expect(loadInactive).toHaveBeenCalledOnce();
      expect(loadEvent).toHaveBeenCalledTimes(3);
      expect(loadChoices).toHaveBeenCalledTimes(2);
      expect(showError).not.toHaveBeenCalled();
      expectSinglePayload();
    }, [() => inactive.resolve(['released']), () => inactiveRead, drainSave]);
  });

  it.each([
    {
      error: new RpcBadRequestError({
        message: 'Return the event to draft before editing it.',
        reason: 'notDraft',
      }),
      message: 'Return the event to draft before editing it.',
    },
    {
      error: new RpcForbiddenError({ message: 'Private permission detail' }),
      message:
        'You do not have access to make this change. Ask your administrator for help.',
    },
    {
      error: new RpcUnauthorizedError({
        message: 'Private authentication detail',
      }),
      message: 'Sign in again before changing this event.',
    },
  ])(
    'preserves safe graph-save denial feedback: $error._tag',
    async ({ error, message }) => {
      await render();
      const entered = entries();
      updateEvent.mockRejectedValueOnce(error);
      invokeSave();
      await expectMessage(message);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(button('Save draft details').disabled).toBe(false);
      });
      expect(entries()).toBe(entered);
      expectSinglePayload();
      expect(loadEvent).toHaveBeenCalledOnce();
      expect(loadChoices).toHaveBeenCalledOnce();
    },
  );
});
