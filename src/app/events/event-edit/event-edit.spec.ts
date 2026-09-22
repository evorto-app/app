import '@angular/compiler';
import type { DiscountProviderRecord } from '@shared/rpc-contracts/app-rpcs/discounts.rpcs';
import type { EventGraphEditRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';
import type { TaxRatesListActiveRecord } from '@shared/rpc-contracts/app-rpcs/tax-rates.rpcs';

import { Component, inject, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideLuxonDateAdapter } from '@angular/material-luxon-adapter';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  provideRouter,
  Router,
  withComponentInputBinding,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  createRpcMutationOptions,
  createRpcQueryFilter,
  createRpcQueryKey,
  createRpcQueryOptions,
} from '@heddendorp/effect-angular-query';
import {
  RpcBadRequestError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import { ClientTenantConfig } from '@shared/rpc-contracts/app-rpcs/config.rpcs';
import {
  EventConflictError,
  EventNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import {
  injectQuery,
  isCancelledError,
  provideTanStackQuery,
  QueryClient,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT, AppRpc } from '../../core/effect-rpc-angular-client';
import { EventDetailsOperations } from '../event-details/event-details.component';
import {
  EventEdit,
  eventEditQueryErrorMessage,
  eventEditSaveErrorMessage,
  eventEditSubmitDisabled,
  eventOptionRemovalBlockReason,
} from './event-edit';
import {
  createEventGraphAddon,
  type EventGraphUpdatePayload,
} from './event-graph-form.model';

describe('event edit error messages', () => {
  it('shows event conflicts and form corrections', () => {
    expect(
      eventEditQueryErrorMessage({
        _tag: 'EventConflictError',
        message: 'This event cannot be edited in its current status.',
      }),
    ).toBe('This event cannot be edited in its current status.');
    expect(
      eventEditSaveErrorMessage({
        _tag: 'RpcBadRequestError',
        message: 'Choose an event end time after its start time.',
      }),
    ).toBe('Choose an event end time after its start time.');
  });

  it('keeps internal and access failures behind plain copy', () => {
    const internalError = {
      _tag: 'RpcInternalServerError',
      message: 'database failed',
    };
    expect(eventEditQueryErrorMessage(internalError)).toBe(
      'The event could not be loaded. Try again.',
    );
    expect(eventEditSaveErrorMessage(internalError)).toBe(
      'The save outcome could not be confirmed. Load the page again to check the current event details before trying again.',
    );
  });
});

describe('eventEditSubmitDisabled', () => {
  it('blocks event edit submits while invalid, submitting, or awaiting the mutation', () => {
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: false,
        graphReadOnly: false,
        mutationPending: false,
        paidGraphBlocked: false,
        taxRatesReady: true,
      }),
    ).toBe(false);
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: true,
        formSubmitting: false,
        graphReadOnly: false,
        mutationPending: false,
        paidGraphBlocked: false,
        taxRatesReady: true,
      }),
    ).toBe(true);
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: true,
        graphReadOnly: false,
        mutationPending: false,
        paidGraphBlocked: false,
        taxRatesReady: true,
      }),
    ).toBe(true);
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: false,
        graphReadOnly: false,
        mutationPending: true,
        paidGraphBlocked: false,
        taxRatesReady: true,
      }),
    ).toBe(true);
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: false,
        graphReadOnly: true,
        mutationPending: false,
        paidGraphBlocked: false,
        taxRatesReady: true,
      }),
    ).toBe(true);
  });

  it('blocks event edit submits until discount providers resolve successfully', () => {
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: false,
        formInvalid: false,
        formSubmitting: false,
        graphReadOnly: false,
        mutationPending: false,
        paidGraphBlocked: false,
        taxRatesReady: true,
      }),
    ).toBe(true);

    const template = readFileSync(
      nodePath.join(process.cwd(), 'src/app/events/event-edit/event-edit.html'),
      'utf8',
    );
    expect(template).toContain('Discount settings could not be loaded.');
    expect(template).toContain('discountProvidersQuery.refetch()');
  });
  it('blocks event edit submits until tax rates resolve successfully', () => {
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: false,
        graphReadOnly: false,
        mutationPending: false,
        paidGraphBlocked: false,
        taxRatesReady: false,
      }),
    ).toBe(true);

    const template = readFileSync(
      nodePath.join(process.cwd(), 'src/app/events/event-edit/event-edit.html'),
      'utf8',
    );
    expect(template).toContain('Tax rates could not be loaded.');
    expect(template).toContain('taxRatesQuery.refetch()');
  });

  it('blocks paid graphs while paid sign-ups are unavailable without resetting them', () => {
    expect(
      eventEditSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: false,
        graphReadOnly: false,
        mutationPending: false,
        paidGraphBlocked: true,
        taxRatesReady: true,
      }),
    ).toBe(true);

    const source = readFileSync(
      nodePath.join(process.cwd(), 'src/app/events/event-edit/event-edit.ts'),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(process.cwd(), 'src/app/events/event-edit/event-edit.html'),
      'utf8',
    );
    expect(source).toContain('paymentsConfigured');
    expect(source).not.toContain('stripeAccountId');
    expect(source).not.toContain('resetEventGraphPayments');
    expect(template).toContain('They remain unchanged');
    expect(template).toContain('cannot save changes until');
  });
});

describe('event edit currency inputs', () => {
  it('shows tenant currency amounts while Signal Forms retain minor units', () => {
    const parentTemplate = readFileSync(
      nodePath.join(process.cwd(), 'src/app/events/event-edit/event-edit.html'),
      'utf8',
    );
    const registrationTemplate = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/events/event-edit/event-registration-option-editor.html',
      ),
      'utf8',
    );
    const addOnTemplate = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/events/event-edit/event-addon-editor.html',
      ),
      'utf8',
    );

    expect(
      parentTemplate.match(/\[currencyCode\]="tenantCurrency\(\)"/g)?.length,
    ).toBe(2);
    expect(
      registrationTemplate.match(/<app-currency-amount-input/g)?.length,
    ).toBe(2);
    expect(addOnTemplate).toContain('<app-currency-amount-input');
    expect(`${registrationTemplate}${addOnTemplate}`).not.toContain('cents');
  });

  it('explains how to add the first add-on', () => {
    const template = readFileSync(
      nodePath.join(process.cwd(), 'src/app/events/event-edit/event-edit.html'),
      'utf8',
    );

    expect(template).toContain(
      'No add-ons yet. Add one to offer extras during sign-up.',
    );
    expect(template).not.toContain('Add-ons are disabled for this event.');
  });
});

describe('eventOptionRemovalBlockReason', () => {
  it('requires explicit reference cleanup instead of cascading graph deletes', () => {
    expect(
      eventOptionRemovalBlockReason(
        {
          addOns: [],
          questions: [
            {
              description: '',
              id: 'question-1',
              key: 'question-1',
              registrationOptionKey: 'option-1',
              required: false,
              sortOrder: 0,
              title: 'Question',
            },
          ],
        },
        'option-1',
      ),
    ).toContain('questions');

    expect(
      eventOptionRemovalBlockReason(
        {
          addOns: [
            {
              allowMultiple: false,
              allowPurchaseBeforeEvent: false,
              allowPurchaseDuringEvent: false,
              allowPurchaseDuringRegistration: true,
              description: '',
              id: 'addon-1',
              isPaid: false,
              key: 'addon-1',
              maxQuantityPerUser: 1,
              price: 0,
              registrationOptions: [
                {
                  includedQuantity: 1,
                  optionalPurchaseQuantity: 0,
                  registrationOptionKey: 'option-1',
                },
              ],
              stripeTaxRateId: null,
              title: 'Lunch',
              totalAvailableQuantity: 20,
            },
          ],
          questions: [],
        },
        'option-1',
      ),
    ).toContain('from its add-ons');

    expect(
      eventOptionRemovalBlockReason({ addOns: [], questions: [] }, 'option-1'),
    ).toBeNull();
  });
});

const savedEventGraph = {
  addOns: [],
  description: '<p>Saved event description</p>',
  end: '2026-09-20T12:00:00.000Z',
  icon: { iconColor: 0, iconName: 'calendar:fas' },
  id: 'event-1',
  location: null,
  questions: [],
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationTime: '2026-09-19T12:00:00.000Z',
      description: null,
      esnCardDiscountedPrice: null,
      id: 'option-1',
      isPaid: true,
      openRegistrationTime: '2026-09-01T12:00:00.000Z',
      organizingRegistration: false,
      price: 1500,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs',
      roleIds: [],
      spots: 20,
      stripeTaxRateId: 'txr_19',
      title: 'Attendees',
      transferDeadlineHoursBeforeStart: null,
    },
  ],
  simpleModeEnabled: false,
  start: '2026-09-20T10:00:00.000Z',
  title: 'Saved event',
} satisfies EventGraphEditRecord;

const saveOutcomeTaxRates = [
  {
    country: 'DE',
    displayName: 'VAT',
    id: 'tax-rate-1',
    percentage: '19',
    state: null,
    stripeTaxRateId: 'txr_19',
  },
] satisfies readonly TaxRatesListActiveRecord[];

const saveOutcomeTenant = new ClientTenantConfig({
  cancellationDeadlineHoursBeforeStart: 24,
  currency: 'EUR',
  defaultLocation: undefined,
  discountProviders: { esnCard: { config: {}, status: 'disabled' } },
  domain: 'tenant.example.test',
  id: 'tenant-1',
  maxActiveRegistrationsPerUser: 3,
  name: 'Tenant',
  paymentsConfigured: true,
  receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
  refundFeesOnCancellation: false,
  theme: 'evorto',
  timezone: 'Europe/Berlin',
  transferDeadlineHoursBeforeStart: 24,
});

type EventDetailRecord = Awaited<
  ReturnType<
    ReturnType<typeof AppRpc.injectClient>['events']['findOne']['call']
  >
>;

const eventDetailFromGraph = (
  graph: EventGraphEditRecord,
): EventDetailRecord => ({
  addOns: [],
  announcementRoleCount: 0,
  announcementRoleIds: null,
  creatorId: 'creator-1',
  description: graph.description,
  end: graph.end,
  hasRegistrationOptions: graph.registrationOptions.length > 0,
  icon: graph.icon,
  id: graph.id,
  location: graph.location,
  registrationOptions: graph.registrationOptions.map((option) => ({
    appliedDiscountType: null,
    checkedInSpots: 0,
    closeRegistrationTime: option.closeRegistrationTime,
    confirmedSpots: 0,
    description: option.description,
    discountApplied: false,
    effectivePrice: option.price,
    esnCardDiscountedPrice: option.esnCardDiscountedPrice ?? null,
    eventId: graph.id,
    id: option.id,
    isPaid: option.isPaid,
    openRegistrationTime: option.openRegistrationTime,
    organizingRegistration: option.organizingRegistration,
    price: option.price,
    questions: [],
    registeredDescription: option.registeredDescription ?? null,
    registrationMode: option.registrationMode,
    reservedSpots: 0,
    roleIds: option.roleIds,
    spots: option.spots,
    stripeTaxRateId: option.stripeTaxRateId ?? null,
    taxRateDisplayName: null,
    taxRatePercentage: null,
    title: option.title,
  })),
  registrationOptionsHiddenByEligibility: false,
  reviewer: null,
  start: graph.start,
  status: 'DRAFT',
  statusComment: null,
  title: graph.title,
  userIsCreator: true,
});

const eventEditRoot = (fixture: ComponentFixture<EventEdit>): HTMLElement => {
  const element: unknown = fixture.nativeElement;
  if (!(element instanceof HTMLElement)) {
    throw new TypeError('Missing event editor element');
  }
  return element;
};

describe('EventEdit save outcomes', () => {
  let fixture: ComponentFixture<EventEdit>;
  let queryClient: QueryClient;
  const findEvent = vi.fn<() => Promise<EventGraphEditRecord>>();
  const loadTaxRates =
    vi.fn<() => Promise<readonly TaxRatesListActiveRecord[]>>();
  const tenant = signal<ClientTenantConfig | null>(saveOutcomeTenant);
  const updateEvent =
    vi.fn<
      (
        input: EventGraphUpdatePayload & { eventId: string },
      ) => Promise<{ id: string }>
    >();

  beforeEach(async () => {
    tenant.set(saveOutcomeTenant);
    loadTaxRates.mockReset();
    loadTaxRates.mockResolvedValue(saveOutcomeTaxRates);
    findEvent.mockReset();
    findEvent.mockResolvedValue(savedEventGraph);
    updateEvent.mockReset();
    updateEvent.mockResolvedValue({ id: 'event-1' });
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    await TestBed.configureTestingModule({
      imports: [EventEdit, MatDialogModule],
      providers: [
        provideRouter([]),
        provideLuxonDateAdapter(),
        provideNoopAnimations(),
        provideTanStackQuery(queryClient),
        {
          provide: ConfigService,
          useValue: {
            permissions: [],
            tenantSignal: tenant,
          } satisfies Pick<ConfigService, 'permissions' | 'tenantSignal'>,
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            discounts: {
              getTenantProviders: {
                queryOptions: () => ({
                  queryFn: () => Promise.resolve([]),
                  queryKey: ['discount-providers'],
                }),
              },
            },
            events: {
              findGraphForEdit: {
                queryOptions: ({ id }: { id: string }) => ({
                  queryFn: findEvent,
                  queryKey: ['events', 'edit', id],
                }),
              },
              findOne: {
                queryOptions: ({ id }: { id: string }) => ({
                  queryFn: async () => eventDetailFromGraph(savedEventGraph),
                  queryKey: ['events', 'findOne', id],
                }),
              },
              updateGraph: {
                mutationOptions: () => ({
                  mutationFn: updateEvent,
                  mutationKey: ['update-event'],
                }),
              },
            },
            queryFilter: () => ({ queryKey: ['events'] }),
            roles: {
              findMany: {
                queryOptions: () => ({
                  queryFn: () => Promise.resolve([]),
                  queryKey: ['roles'],
                }),
              },
            },
            taxRates: {
              listActive: {
                queryOptions: () => ({
                  queryFn: loadTaxRates,
                  queryKey: ['tax-rates'],
                }),
              },
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(EventEdit);
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance['eventModel']().title).toBe(
        'Saved event',
      );
      expect(fixture.componentInstance['discountProvidersReady']()).toBe(true);
      expect(fixture.componentInstance['taxRatesReady']()).toBe(true);
      expect(fixture.componentInstance['eventForm']().invalid()).toBe(false);
    });
    const input = [...eventEditRoot(fixture).querySelectorAll('mat-form-field')]
      .find(
        (field) =>
          field.querySelector('mat-label')?.textContent?.trim() ===
          'Event title',
      )
      ?.querySelector('input');
    if (!(input instanceof HTMLInputElement))
      throw new Error('Missing title input');
    input.value = 'Edited event';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance['eventModel']().title).toBe(
      'Edited event',
    );
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    fixture?.destroy();
    queryClient?.clear();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  const submitEvent = async () => {
    const modelSnapshot = JSON.stringify(
      fixture.componentInstance['eventModel'](),
    );
    const formElement = eventEditRoot(fixture).querySelector('form');
    if (!(formElement instanceof HTMLFormElement))
      throw new Error('Missing event form');
    const event = new Event('submit', { bubbles: true, cancelable: true });
    formElement.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(updateEvent).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(fixture.componentInstance['eventForm']().submitting()).toBe(false),
    );
    fixture.detectChanges();
    expect(JSON.stringify(fixture.componentInstance['eventModel']())).toBe(
      modelSnapshot,
    );
    const titleInput = [
      ...eventEditRoot(fixture).querySelectorAll('mat-form-field'),
    ]
      .find(
        (field) =>
          field.querySelector('mat-label')?.textContent?.trim() ===
          'Event title',
      )
      ?.querySelector('input');
    expect(titleInput?.value).toBe('Edited event');
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(updateEvent.mock.calls[0]?.[0]).toMatchObject({
      description: '<p>Saved event description</p>',
      eventId: 'event-1',
      registrationOptions: [
        {
          id: 'option-1',
          isPaid: true,
          price: 1500,
          stripeTaxRateId: 'txr_19',
        },
      ],
      title: 'Edited event',
    });
  };

  const expectMessage = (message: string) => {
    expect(fixture.componentInstance['saveError']()).toBe(message);
    expect(
      eventEditRoot(fixture)
        .querySelector('[role="alert"]')
        ?.textContent?.trim(),
    ).toBe(message);
  };

  it('asks to check the current event when a committed save loses its response', async () => {
    let committed = false;
    updateEvent.mockImplementation(async () => {
      committed = true;
      throw new Error('Response connection lost after commit');
    });
    await submitEvent();
    expect(committed).toBe(true);
    expectMessage(
      'The save outcome could not be confirmed. Load the page again to check the current event details before trying again.',
    );
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
  });

  it('does not claim an internal mutation failure means that nothing was saved', async () => {
    updateEvent.mockRejectedValue(
      new RpcInternalServerError({ message: 'database failed' }),
    );
    await submitEvent();
    expectMessage(
      'The save outcome could not be confirmed. Load the page again to check the current event details before trying again.',
    );
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
  });

  it.each([
    new EventConflictError({
      message: 'This event cannot be edited in its current status.',
    }),
    new EventNotFoundError({ message: 'This event could not be found.' }),
    new RpcBadRequestError({
      message: 'Choose an available tax rate for each paid sign-up choice.',
    }),
  ])('preserves expected mutation denial feedback for $_tag', async (error) => {
    updateEvent.mockRejectedValue(error);
    await submitEvent();
    expectMessage(error.message);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
  });

  it('reports a confirmed save when refreshing the event queries fails', async () => {
    vi.mocked(queryClient.invalidateQueries).mockRestore();
    const invalidation = vi.spyOn(queryClient, 'invalidateQueries');
    findEvent.mockRejectedValue(
      new Error('Active event query failed to refresh'),
    );
    await submitEvent();
    expectMessage(
      'The event was saved, but its latest details could not be loaded. Load the page again to see the saved event.',
    );
    expect(invalidation).toHaveBeenCalledExactlyOnceWith(
      { queryKey: ['events'] },
      { throwOnError: true },
    );
    expect(findEvent).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance['eventQuery'].isError()).toBe(true);
    expect(eventEditRoot(fixture).querySelector('form')).not.toBeNull();
    expect(eventEditRoot(fixture).textContent).not.toContain(
      'Event editor unavailable',
    );
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
  });

  it.each(['reject', 'false'])(
    'reports a confirmed save when navigation returns %s',
    async (outcome) => {
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      if (outcome === 'reject')
        navigate.mockRejectedValue(new Error('Navigation failed'));
      else navigate.mockResolvedValue(false);
      await submitEvent();
      expectMessage(
        'The event was saved, but its page could not be opened. Open it from the event list.',
      );
      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledExactlyOnceWith(['/events', 'event-1']);
    },
  );

  it('blocks duplicate submits while confirmed-save navigation is still pending', async () => {
    let finishNavigation: ((value: boolean) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const navigation = new Promise<boolean>((resolve) => {
      finishNavigation = resolve;
    });
    vi.mocked(TestBed.inject(Router).navigate).mockReturnValue(navigation);
    const submission = submitEvent();
    try {
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(TestBed.inject(Router).navigate).toHaveBeenCalledTimes(1);
        expect(
          fixture.componentInstance['updateEventMutation'].isPending(),
        ).toBe(false);
        expect(fixture.componentInstance['eventForm']().submitting()).toBe(
          true,
        );
      });
      const button = eventEditRoot(fixture).querySelector(
        '[data-testid="save-event-graph"]',
      );
      if (!(button instanceof HTMLButtonElement))
        throw new Error('Missing save button');
      expect(button.disabled).toBe(true);
      await fixture.componentInstance['saveEvent'](new Event('submit'));
      expect(updateEvent).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance['eventForm']().submitting()).toBe(true);
    } finally {
      finishNavigation?.(true);
      await submission;
    }
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance['eventForm']().submitting()).toBe(false);
  });

  it('opens the saved event after one successful mutation', async () => {
    await submitEvent();
    expect(fixture.componentInstance['saveError']()).toBeNull();
    expect(eventEditRoot(fixture).querySelector('[role="alert"]')).toBeNull();
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledExactlyOnceWith([
      '/events',
      'event-1',
    ]);
  });

  it('preserves paid choices and add-ons through tax failure and account unavailability', async () => {
    const component = fixture.componentInstance;
    const enabledTenant = new ClientTenantConfig({
      ...saveOutcomeTenant,
      discountProviders: { esnCard: { config: {}, status: 'enabled' } },
    });
    tenant.set(enabledTenant);
    queryClient.setQueryData<readonly DiscountProviderRecord[]>(
      ['discount-providers'],
      [{ config: {}, status: 'enabled', type: 'esnCard' }],
    );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(component['esnEnabled']()).toBe(true);
    });
    const optionKey = component['eventModel']().registrationOptions[0]?.key;
    if (!optionKey) throw new Error('Missing paid choice');
    queryClient.setQueryData(['discount-providers'], [
      { config: {}, status: 'enabled', type: 'esnCard' },
    ] satisfies readonly DiscountProviderRecord[]);
    component['eventModel'].update((model) => ({
      ...model,
      addOns: [
        {
          ...createEventGraphAddon(optionKey),
          isPaid: true,
          price: 450,
          stripeTaxRateId: 'txr_19',
          title: 'Lunch',
          totalAvailableQuantity: 20,
        },
      ],
      registrationOptions: model.registrationOptions.map((option) => ({
        ...option,
        esnCardDiscountedPrice: 750,
      })),
    }));
    fixture.detectChanges();
    const snapshot = JSON.stringify(component['eventModel']());
    const button = eventEditRoot(fixture).querySelector(
      '[data-testid="save-event-graph"]',
    );
    if (!(button instanceof HTMLButtonElement))
      throw new Error('Missing save button');
    const expectPrices = () => {
      const inputs = eventEditRoot(fixture).querySelectorAll<HTMLInputElement>(
        ':scope app-currency-amount-input input',
      );
      expect(
        [...inputs].map((input) => Number(input.value.replace(',', '.'))),
      ).toEqual([15, 7.5, 4.5]);
      expect(JSON.stringify(component['eventModel']())).toBe(snapshot);
    };
    expect(button.disabled).toBe(false);
    expectPrices();

    loadTaxRates.mockRejectedValueOnce(new Error('Tax choices unavailable'));
    await component['taxRatesQuery'].refetch();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(component['taxRatesQuery'].isError()).toBe(true);
      expect(button.disabled).toBe(true);
      expect(eventEditRoot(fixture).textContent).toContain(
        'Tax rates could not be loaded.',
      );
    });
    await component['saveEvent'](new Event('submit'));
    expect(updateEvent).not.toHaveBeenCalled();
    expectPrices();

    await component['taxRatesQuery'].refetch();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button.disabled).toBe(false);
    });
    tenant.set(
      new ClientTenantConfig({
        ...enabledTenant,
        paymentsConfigured: false,
      }),
    );
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
    expect(eventEditRoot(fixture).textContent).toContain(
      'They remain unchanged',
    );
    await component['saveEvent'](new Event('submit'));
    expect(updateEvent).not.toHaveBeenCalled();
    expectPrices();

    tenant.set(enabledTenant);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(button.disabled).toBe(false);
    });
    await submitEvent();
    expect(
      updateEvent.mock.calls[0]?.[0].registrationOptions[0]
        ?.esnCardDiscountedPrice,
    ).toBe(750);
    expect(updateEvent.mock.calls[0]?.[0].addOns).toMatchObject([
      {
        isPaid: true,
        price: 450,
        registrationOptions: [
          {
            includedQuantity: 0,
            optionalPurchaseQuantity: 1,
            registrationOptionKey: optionKey,
          },
        ],
        stripeTaxRateId: 'txr_19',
        title: 'Lunch',
      },
    ]);
    expectPrices();
  });

  it('saves removal of an extra choice and the switch to simple setup together', async () => {
    const attendee = savedEventGraph.registrationOptions[0];
    if (!attendee) throw new Error('Missing attendee choice');
    const stored: EventGraphEditRecord = {
      ...savedEventGraph,
      registrationOptions: [
        { ...attendee, id: 'extra', title: 'Extra choice' },
        {
          ...attendee,
          id: 'organizer',
          organizingRegistration: true,
          title: 'Organizers',
        },
        attendee,
      ],
      title: 'Edited event',
    };
    fixture.destroy();
    queryClient.removeQueries({
      exact: true,
      queryKey: ['events', 'edit', 'event-1'],
    });
    findEvent.mockResolvedValue(stored);
    fixture = TestBed.createComponent(EventEdit);
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.detectChanges();
    const component = fixture.componentInstance;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(component['eventModel']().registrationOptions).toHaveLength(3);
      expect(
        eventEditRoot(fixture).querySelectorAll(
          'app-event-registration-option-editor',
        ),
      ).toHaveLength(3);
    });
    const extraEditor = [
      ...eventEditRoot(fixture).querySelectorAll(
        'app-event-registration-option-editor',
      ),
    ].find((editor) =>
      [...editor.querySelectorAll('input')].some(
        (input) => input.value === 'Extra choice',
      ),
    );
    const removeButton = [
      ...(extraEditor?.querySelectorAll('button') ?? []),
    ].find((button) => button.textContent?.trim() === 'Remove choice');
    if (!(removeButton instanceof HTMLButtonElement))
      throw new Error('Missing extra choice remove button');
    removeButton.click();
    fixture.detectChanges();
    expect(component['eventQuery'].data()?.registrationOptions).toHaveLength(3);
    expect(component['eventModel']().registrationOptions).toHaveLength(2);
    const snapshot = JSON.stringify(component['eventModel']());
    const simpleButton = eventEditRoot(fixture).querySelector(
      '[data-testid="event-mode-simple"]',
    );
    if (!(simpleButton instanceof HTMLButtonElement))
      throw new Error('Missing simple setup button');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(simpleButton.disabled).toBe(false);
    });
    simpleButton.click();
    try {
      await vi.waitFor(() =>
        expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(1),
      );
      const dialog = document.querySelector('mat-dialog-container');
      expect(dialog?.textContent).toContain('Change sign-up setup?');
      const confirmationButton = () =>
        [...(dialog?.querySelectorAll('button') ?? [])].find(
          (button) =>
            button.textContent?.replaceAll(/\s+/g, ' ').trim() ===
            'Use simple setup',
        );
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(confirmationButton()).toBeInstanceOf(HTMLButtonElement);
        expect(confirmationButton()?.disabled).toBe(false);
      });
      const confirm = confirmationButton();
      if (!(confirm instanceof HTMLButtonElement))
        throw new Error('Missing setup confirmation');
      expect(updateEvent).not.toHaveBeenCalled();
      confirm.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(component['eventModel']().simpleModeEnabled).toBe(true);
      });
    } finally {
      TestBed.inject(MatDialog).closeAll();
      await fixture.whenStable();
    }
    expect(
      JSON.stringify({
        ...component['eventModel'](),
        simpleModeEnabled: false,
      }),
    ).toBe(snapshot);
    await component['saveEvent'](new Event('submit'));
    expect(updateEvent).toHaveBeenCalledOnce();
    const { id, ...graph } = stored;
    expect(updateEvent.mock.calls[0]?.[0]).toEqual({
      ...graph,
      eventId: id,
      registrationOptions: stored.registrationOptions
        .filter((option) => option.id !== 'extra')
        .map((option) => ({ ...option, key: option.id })),
      simpleModeEnabled: true,
    });
  });

  it.each(['question', 'add-on'])(
    'removes the first %s through its public action while preserving surviving controls and the saved graph',
    async (kind) => {
      const stored: EventGraphEditRecord = {
        ...savedEventGraph,
        addOns: ['First add-on', 'Kept add-on'].map((title, index) => ({
          allowMultiple: false,
          allowPurchaseBeforeEvent: false,
          allowPurchaseDuringEvent: false,
          allowPurchaseDuringRegistration: true,
          description: '<p>Included equipment</p>',
          id: `addon-${index}`,
          isPaid: true,
          maxQuantityPerUser: 1,
          price: 450,
          registrationOptions: [
            {
              includedQuantity: 0,
              optionalPurchaseQuantity: 1,
              registrationOptionId: 'option-1',
            },
          ],
          stripeTaxRateId: 'txr_19',
          title,
          totalAvailableQuantity: 20,
        })),
        questions: ['First question', 'Kept question'].map((title, index) => ({
          description: '<p>Answer before attending</p>',
          id: `question-${index}`,
          registrationOptionId: 'option-1',
          required: false,
          sortOrder: index,
          title,
        })),
        title: 'Edited event',
      };
      fixture.destroy();
      queryClient.removeQueries({
        exact: true,
        queryKey: ['events', 'edit', 'event-1'],
      });
      findEvent.mockResolvedValue(stored);
      fixture = TestBed.createComponent(EventEdit);
      fixture.componentRef.setInput('eventId', 'event-1');
      fixture.detectChanges();
      const component = fixture.componentInstance;
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(component['eventModel']().questions).toHaveLength(2);
        expect(component['eventModel']().addOns).toHaveLength(2);
      });
      const keptTitle = kind === 'question' ? 'Kept question' : 'Kept add-on';
      const keptInput = [
        ...eventEditRoot(fixture).querySelectorAll('input'),
      ].find((input) => input.value === keptTitle);
      if (!(keptInput instanceof HTMLInputElement))
        throw new Error('Missing retained row input');
      keptInput.value = 'Edited retained row';
      keptInput.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      const rowField =
        kind === 'question'
          ? component['eventForm'].questions[1]
          : component['eventForm'].addOns[1];
      const removeText =
        kind === 'question' ? 'Remove question' : 'Remove add-on';
      const removeButtons = [
        ...eventEditRoot(fixture).querySelectorAll('button'),
      ].filter((button) => button.textContent?.trim() === removeText);
      expect(removeButtons).toHaveLength(2);
      const removeButton = removeButtons[0];
      if (!(removeButton instanceof HTMLButtonElement))
        throw new Error('Missing first row remove button');
      removeButton.click();
      fixture.detectChanges();
      expect(eventEditRoot(fixture).contains(keptInput)).toBe(true);
      expect(keptInput.value).toBe('Edited retained row');
      expect(
        kind === 'question'
          ? component['eventForm'].questions[0]
          : component['eventForm'].addOns[0],
      ).toBe(rowField);
      expect(rowField?.title().dirty()).toBe(true);
      await component['saveEvent'](new Event('submit'));
      expect(updateEvent).toHaveBeenCalledOnce();
      const { id, ...graph } = stored;
      expect(updateEvent.mock.calls[0]?.[0]).toEqual({
        ...graph,
        addOns: stored.addOns
          .filter((_, index) => kind !== 'add-on' || index === 1)
          .map((addOn) => ({
            ...addOn,
            key: addOn.id,
            registrationOptions: addOn.registrationOptions.map(
              ({ registrationOptionId, ...mapping }) => ({
                ...mapping,
                registrationOptionKey: registrationOptionId,
              }),
            ),
            title: kind === 'add-on' ? 'Edited retained row' : addOn.title,
          })),
        eventId: id,
        questions: stored.questions
          .filter((_, index) => kind !== 'question' || index === 1)
          .map(({ registrationOptionId, ...question }) => ({
            ...question,
            key: question.id,
            registrationOptionKey: registrationOptionId,
            title: kind === 'question' ? 'Edited retained row' : question.title,
          })),
        registrationOptions: stored.registrationOptions.map((option) => ({
          ...option,
          key: option.id,
        })),
      });
    },
  );

  it('keeps the graph unchanged when a setup change is declined', async () => {
    const component = fixture.componentInstance;
    const attendee = component['eventModel']().registrationOptions[0];
    if (!attendee) throw new Error('Missing attendee choice');
    component['eventModel'].update((model) => ({
      ...model,
      registrationOptions: [
        {
          ...attendee,
          id: 'organizer',
          key: 'organizer',
          organizingRegistration: true,
        },
        attendee,
      ],
    }));
    fixture.detectChanges();
    const snapshot = JSON.stringify(component['eventModel']());
    await vi.waitFor(() =>
      expect(component['modeControlsInteractive']()).toBe(true),
    );
    const change = component['requestModeChange'](true);
    try {
      await vi.waitFor(() =>
        expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(1),
      );
      const dialog = document.querySelector('mat-dialog-container');
      const cancel = [...(dialog?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent?.trim() === 'Keep current setup',
      );
      if (!(cancel instanceof HTMLButtonElement))
        throw new Error('Missing setup cancel button');
      cancel.click();
      await change;
    } finally {
      TestBed.inject(MatDialog).closeAll();
      await change;
    }
    expect(JSON.stringify(component['eventModel']())).toBe(snapshot);
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('keeps saving locked until active event reads settle after one rejects', async () => {
    vi.mocked(queryClient.invalidateQueries).mockRestore();
    const invalidation = vi.spyOn(queryClient, 'invalidateQueries');
    let finishSibling: ((value: string[]) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const siblingRead = new Promise<string[]>((resolve) => {
      finishSibling = resolve;
    });
    const findRelatedEvents = vi.fn(async () => ['related-event']);
    const relatedKey = ['events', 'related'];
    const observer = new QueryObserver(queryClient, {
      queryFn: findRelatedEvents,
      queryKey: relatedKey,
    });
    let relatedStatus = 'pending';
    const unsubscribe = observer.subscribe((result) => {
      relatedStatus = result.status;
    });
    let submission: Promise<void> | undefined;
    const modelSnapshot = JSON.stringify(
      fixture.componentInstance['eventModel'](),
    );
    try {
      await vi.waitFor(() => expect(relatedStatus).toBe('success'));
      findRelatedEvents.mockReturnValueOnce(siblingRead);
      findEvent.mockRejectedValueOnce(
        new Error('Event details failed before related events settled'),
      );
      submission = fixture.componentInstance['saveEvent'](
        new Event('submit', { cancelable: true }),
      );
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(findRelatedEvents).toHaveBeenCalledTimes(2);
        expect(fixture.componentInstance['eventQuery'].isError()).toBe(true);
        expect(queryClient.getQueryState(relatedKey)?.fetchStatus).toBe(
          'fetching',
        );
        expect(
          fixture.componentInstance['updateEventMutation'].isPending(),
        ).toBe(false);
        expect(fixture.componentInstance['eventForm']().submitting()).toBe(
          true,
        );
      });
      const saveButton = eventEditRoot(fixture).querySelector(
        '[data-testid="save-event-graph"]',
      );
      if (!(saveButton instanceof HTMLButtonElement))
        throw new TypeError('Missing save button');
      expect(saveButton.disabled).toBe(true);
      expect(fixture.componentInstance['saveError']()).toBeNull();
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
      await fixture.componentInstance['saveEvent'](new Event('submit'));
      expect(updateEvent).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance['eventForm']().submitting()).toBe(true);
      if (!finishSibling) throw new Error('Expected an owned sibling read');
      finishSibling(['related-event']);
      await submission;
      fixture.detectChanges();
      expect(fixture.componentInstance['eventForm']().submitting()).toBe(false);
      expect(saveButton.disabled).toBe(false);
      expectMessage(
        'The event was saved, but its latest details could not be loaded. Load the page again to see the saved event.',
      );
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
      expect(invalidation).toHaveBeenCalledExactlyOnceWith(
        { queryKey: ['events'] },
        { throwOnError: true },
      );
      expect(findEvent).toHaveBeenCalledTimes(2);
      expect(findRelatedEvents).toHaveBeenCalledTimes(2);
      expect(updateEvent).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(fixture.componentInstance['eventModel']())).toBe(
        modelSnapshot,
      );
      const titleInput = [
        ...eventEditRoot(fixture).querySelectorAll('mat-form-field'),
      ]
        .find(
          (field) =>
            field.querySelector('mat-label')?.textContent?.trim() ===
            'Event title',
        )
        ?.querySelector('input');
      expect(titleInput?.value).toBe('Edited event');
      const payload = updateEvent.mock.calls[0]?.[0];
      if (!payload) throw new Error('Expected the submitted event payload');
      const serializedPayload = JSON.stringify(payload);
      const publicPayload: unknown = JSON.parse(serializedPayload);
      expect(publicPayload).toEqual({
        addOns: [],
        description: savedEventGraph.description,
        end: savedEventGraph.end,
        eventId: 'event-1',
        icon: { iconColor: 0, iconName: 'calendar:fas' },
        location: null,
        questions: [],
        registrationOptions: savedEventGraph.registrationOptions.map(
          (option) => ({ ...option, key: option.id }),
        ),
        simpleModeEnabled: false,
        start: savedEventGraph.start,
        title: 'Edited event',
      });
    } finally {
      finishSibling?.(['released']);
      try {
        await submission;
      } finally {
        unsubscribe();
      }
    }
  });

  it('does not hold saving for an inactive matching read that invalidation does not refetch', async () => {
    vi.mocked(queryClient.invalidateQueries).mockRestore();
    const invalidation = vi.spyOn(queryClient, 'invalidateQueries');
    let finishInactive: ((value: string[]) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const heldInactive = new Promise<string[]>((resolve) => {
      finishInactive = resolve;
    });
    const inactiveKey = ['events', 'inactive-related'];
    const findInactive = vi.fn(() => heldInactive);
    const inactiveRead = queryClient.fetchQuery({
      queryFn: findInactive,
      queryKey: inactiveKey,
    });
    let submission: Promise<void> | undefined;
    const modelSnapshot = JSON.stringify(
      fixture.componentInstance['eventModel'](),
    );
    try {
      expect(
        queryClient
          .getQueryCache()
          .find({ exact: true, queryKey: inactiveKey })
          ?.isActive(),
      ).toBe(false);
      expect(queryClient.getQueryState(inactiveKey)?.fetchStatus).toBe(
        'fetching',
      );
      submission = fixture.componentInstance['saveEvent'](
        new Event('submit', { cancelable: true }),
      );
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(TestBed.inject(Router).navigate).toHaveBeenCalledExactlyOnceWith(
          ['/events', 'event-1'],
        );
        expect(fixture.componentInstance['eventForm']().submitting()).toBe(
          false,
        );
      });
      const saveButton = eventEditRoot(fixture).querySelector(
        '[data-testid="save-event-graph"]',
      );
      if (!(saveButton instanceof HTMLButtonElement))
        throw new TypeError('Missing save button');
      expect(saveButton.disabled).toBe(false);
      expect(queryClient.getQueryState(inactiveKey)?.fetchStatus).toBe(
        'fetching',
      );
      expect(findInactive).toHaveBeenCalledTimes(1);
      expect(findEvent).toHaveBeenCalledTimes(2);
      expect(updateEvent).toHaveBeenCalledTimes(1);
      expect(invalidation).toHaveBeenCalledExactlyOnceWith(
        { queryKey: ['events'] },
        { throwOnError: true },
      );
      expect(fixture.componentInstance['saveError']()).toBeNull();
      expect(JSON.stringify(fixture.componentInstance['eventModel']())).toBe(
        modelSnapshot,
      );
    } finally {
      finishInactive?.(['released']);
      try {
        await inactiveRead;
      } finally {
        await submission;
      }
    }
  });
});

@Component({
  selector: 'app-test-event-save-detail-destination',
  template: `
    @if (eventQuery.isSuccess()) {
      <h1>{{ eventQuery.data().title }}</h1>
      @for (option of eventQuery.data().registrationOptions; track option.id) {
        <h2>{{ option.title }}</h2>
      }
    }
  `,
})
class EventSaveDetailDestination {
  readonly eventId = input.required<string>();
  private readonly operations = inject(EventDetailsOperations);
  readonly eventQuery = injectQuery(() =>
    this.operations.findEvent(this.eventId()),
  );
}

describe('EventEdit return to an inactive detail query', () => {
  type Client = ReturnType<typeof AppRpc.injectClient>;
  type DetailOptions = ReturnType<Client['events']['findOne']['queryOptions']>;
  type SaveMutation = NonNullable<
    ReturnType<Client['events']['updateGraph']['mutationOptions']>['mutationFn']
  >;
  const retainedOption = savedEventGraph.registrationOptions[0];
  const initialGraph: EventGraphEditRecord = {
    ...savedEventGraph,
    registrationOptions: [
      {
        ...retainedOption,
        id: 'deleted-choice',
        title: 'First attendee choice',
      },
      { ...retainedOption, title: 'Old retained choice' },
    ],
  };
  let currentGraph: EventGraphEditRecord;
  let queryClient: QueryClient;
  let harness: RouterTestingHarness | undefined;
  let editor: EventEdit;
  let root: HTMLElement;
  let releases: (() => void)[] = [];
  let observed: Promise<PromiseSettledResult<void>>[] = [];
  const readDetail = vi.fn<Client['events']['findOne']['call']>();
  const readGraph = vi.fn<Client['events']['findGraphForEdit']['call']>();
  const saveGraph = vi.fn<SaveMutation>();
  const detailOptions = (input: { id: string }): DetailOptions =>
    createRpcQueryOptions({
      input,
      keyPrefix: 'rpc',
      pathSegments: ['events', 'findOne'],
      queryFn: () => readDetail(input),
      type: 'query',
    });
  const detailKey = createRpcQueryKey(['events', 'findOne'], {
    input: { id: 'event-1' },
    keyPrefix: 'rpc',
    type: 'query',
  });
  const own = (operation: Promise<void>) => {
    observed.push(
      operation.then<PromiseSettledResult<void>, PromiseSettledResult<void>>(
        () => ({ status: 'fulfilled', value: undefined }),
        (error: unknown) => ({ reason: error, status: 'rejected' }),
      ),
    );
    return operation;
  };
  const heldDetail = () => {
    let release: (value: EventDetailRecord) => void = () => {
      throw new Error('Detail gate was not initialized');
    };
    // Angular's ES2022 library does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const promise = new Promise<EventDetailRecord>((resolve) => {
      release = resolve;
    });
    own(
      promise.then(() => {
        // Observe settlement without retaining the detail payload.
      }),
    );
    releases.push(() => release(eventDetailFromGraph(currentGraph)));
    return { promise, release };
  };

  beforeEach(async () => {
    harness = undefined;
    releases = [];
    observed = [];
    currentGraph = initialGraph;
    readDetail
      .mockReset()
      .mockImplementation(async () => eventDetailFromGraph(currentGraph));
    readGraph.mockReset().mockImplementation(async () => currentGraph);
    saveGraph.mockReset().mockImplementation(async (payload) => {
      currentGraph = {
        ...currentGraph,
        registrationOptions: payload.registrationOptions.map((option) => {
          if (!option.id)
            throw new Error('This fixture only edits existing choices');
          return { ...option, id: option.id };
        }),
        title: payload.title,
      };
      return { id: currentGraph.id };
    });
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    await TestBed.configureTestingModule({
      imports: [EventEdit, EventSaveDetailDestination, MatDialogModule],
      providers: [
        provideRouter(
          [
            { component: EventEdit, path: 'events/:eventId/edit' },
            { component: EventSaveDetailDestination, path: 'events/:eventId' },
          ],
          withComponentInputBinding(),
        ),
        provideLuxonDateAdapter(),
        provideNoopAnimations(),
        provideTanStackQuery(queryClient),
        {
          provide: ConfigService,
          useValue: {
            permissions: [],
            tenantSignal: signal<ClientTenantConfig | null>(saveOutcomeTenant),
          } satisfies Pick<ConfigService, 'permissions' | 'tenantSignal'>,
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            discounts: {
              getTenantProviders: {
                queryOptions: () => ({
                  queryFn: async () => [],
                  queryKey: ['discount-providers'],
                }),
              },
            },
            events: {
              findGraphForEdit: {
                queryOptions: (input: { id: string }) =>
                  createRpcQueryOptions({
                    input,
                    keyPrefix: 'rpc',
                    pathSegments: ['events', 'findGraphForEdit'],
                    queryFn: () => readGraph(input),
                    type: 'query',
                  }),
              },
              findOne: { queryOptions: detailOptions },
              updateGraph: {
                mutationOptions: () =>
                  createRpcMutationOptions({
                    keyPrefix: 'rpc',
                    mutationFn: saveGraph,
                    pathSegments: ['events', 'updateGraph'],
                  }),
              },
            },
            queryFilter: (segments: readonly string[]) =>
              createRpcQueryFilter(segments, { keyPrefix: 'rpc' }),
            roles: {
              findMany: {
                queryOptions: () => ({
                  queryFn: async () => [],
                  queryKey: ['roles'],
                }),
              },
            },
            taxRates: {
              listActive: {
                queryOptions: () => ({
                  queryFn: async () => saveOutcomeTaxRates,
                  queryKey: ['tax-rates'],
                }),
              },
            },
          },
        },
      ],
      teardown: { destroyAfterEach: true },
    }).compileComponents();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/events/event-1', EventSaveDetailDestination);
    await vi.waitFor(() => {
      harness?.detectChanges();
      expect(harness?.routeNativeElement?.textContent).toContain(
        'First attendee choice',
      );
      expect(harness?.routeNativeElement?.textContent).toContain(
        'Old retained choice',
      );
      expect(readDetail).toHaveBeenCalledOnce();
    });
    editor = await harness.navigateByUrl('/events/event-1/edit', EventEdit);
    const element = harness.routeNativeElement;
    if (!element) throw new Error('Expected the routed event editor');
    root = element;
    await vi.waitFor(() => {
      harness?.detectChanges();
      expect(editor['eventModel']().registrationOptions).toHaveLength(2);
      expect(editor['eventForm']().invalid()).toBe(false);
      expect(editor['discountProvidersReady']()).toBe(true);
      expect(editor['taxRatesReady']()).toBe(true);
    });
    expect(
      queryClient
        .getQueryCache()
        .find({ exact: true, queryKey: detailKey })
        ?.isActive(),
    ).toBe(false);
    expect(queryClient.getQueryData(detailKey)).toEqual(
      eventDetailFromGraph(initialGraph),
    );
    const firstChoice = root.querySelector(
      'app-event-registration-option-editor',
    );
    const remove = [
      ...(firstChoice?.querySelectorAll<HTMLButtonElement>('button') ?? []),
    ].find((button) => button.textContent?.trim() === 'Remove choice');
    if (!remove)
      throw new Error('Expected the first public Remove choice action');
    remove.click();
    await vi.waitFor(() => {
      harness?.detectChanges();
      expect(editor['eventModel']().registrationOptions).toHaveLength(1);
    });
    for (const [label, value] of [
      ['Event title', 'Saved current event'],
      ['Sign-up choice name', 'Browser retained attendee'],
    ]) {
      const input = [...root.querySelectorAll('mat-form-field')]
        .find(
          (field) =>
            field.querySelector('mat-label')?.textContent?.trim() === label,
        )
        ?.querySelector('input');
      if (!(input instanceof HTMLInputElement))
        throw new Error(`Expected ${label}`);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    harness.detectChanges();
    expect(editor['eventModel']().title).toBe('Saved current event');
    expect(editor['eventModel']().registrationOptions[0]?.title).toBe(
      'Browser retained attendee',
    );
  });

  afterEach(async () => {
    const failures: unknown[] = [];
    for (const release of releases) {
      try {
        release();
      } catch (error) {
        failures.push(error);
      }
    }
    const results = await Promise.all(observed);
    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    for (const cleanup of [
      () => harness?.fixture.destroy(),
      () => TestBed.resetTestingModule(),
      () => queryClient?.clear(),
      () => vi.restoreAllMocks(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Event navigation fixture cleanup failed',
      );
  });

  it('replaces an older inactive detail read and renders the saved choices on real return navigation', async () => {
    const olderRead = heldDetail();
    const currentRead = heldDetail();
    readDetail.mockImplementationOnce(() => olderRead.promise);
    const olderFetch = queryClient.fetchQuery(detailOptions({ id: 'event-1' }));
    const olderRetryer = queryClient.getQueryCache().find({
      exact: true,
      queryKey: detailKey,
    })?.promise;
    if (!olderRetryer) throw new Error('Expected the older detail retryer');
    const cancelledRetryer = own(
      olderRetryer.then(
        () => {
          throw new Error(
            'The superseded detail retryer unexpectedly completed',
          );
        },
        (error: unknown) => {
          expect(isCancelledError(error)).toBe(true);
        },
      ),
    );
    // Revert cancellation rejects the retryer but resolves fetchQuery with
    // the previous cached data when this is not an initial fetch.
    const revertedFetch = own(
      olderFetch.then((data) => {
        expect(data).toEqual(eventDetailFromGraph(initialGraph));
      }),
    );
    await vi.waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
    readDetail.mockImplementationOnce(() => currentRead.promise);
    const submission = own(
      editor['saveEvent'](new Event('submit', { cancelable: true })),
    );
    await vi.waitFor(() => {
      harness?.detectChanges();
      expect(saveGraph).toHaveBeenCalledOnce();
      expect(readDetail).toHaveBeenCalledTimes(3);
      expect(TestBed.inject(Router).url).toBe('/events/event-1/edit');
      expect(editor['eventForm']().submitting()).toBe(true);
      expect(
        queryClient
          .getQueryCache()
          .find({ exact: true, queryKey: detailKey })
          ?.isActive(),
      ).toBe(false);
    });
    await cancelledRetryer;
    await revertedFetch;
    expect(queryClient.getQueryData(detailKey)).toEqual(
      eventDetailFromGraph(initialGraph),
    );
    await editor['saveEvent'](new Event('submit', { cancelable: true }));
    expect(saveGraph).toHaveBeenCalledOnce();
    const submitted = saveGraph.mock.calls[0]?.[0];
    expect(submitted?.title).toBe('Saved current event');
    expect(
      submitted?.registrationOptions.map(({ id, title }) => ({ id, title })),
    ).toEqual([{ id: 'option-1', title: 'Browser retained attendee' }]);
    currentRead.release(eventDetailFromGraph(currentGraph));
    await submission;
    await vi.waitFor(() => {
      harness?.detectChanges();
      expect(TestBed.inject(Router).url).toBe('/events/event-1');
      expect(
        harness?.routeNativeElement?.querySelector('h1')?.textContent,
      ).toBe('Saved current event');
      expect(
        [...(harness?.routeNativeElement?.querySelectorAll('h2') ?? [])].map(
          (heading) => heading.textContent,
        ),
      ).toEqual(['Browser retained attendee']);
    });
    olderRead.release(eventDetailFromGraph(initialGraph));
    await olderRead.promise;
    await harness?.fixture.whenStable();
    expect(queryClient.getQueryData(detailKey)).toEqual(
      eventDetailFromGraph(currentGraph),
    );
    expect(harness?.routeNativeElement?.textContent).not.toContain(
      'First attendee choice',
    );
    expect(harness?.routeNativeElement?.textContent).not.toContain(
      'Old retained choice',
    );
    expect(saveGraph).toHaveBeenCalledOnce();
  });

  it('keeps the saved editor and entered values when the inactive destination read fails', async () => {
    readDetail.mockRejectedValueOnce(
      new Error('Private destination read failure'),
    );
    await own(editor['saveEvent'](new Event('submit', { cancelable: true })));
    harness?.detectChanges();
    expect(saveGraph).toHaveBeenCalledOnce();
    expect(readDetail).toHaveBeenCalledTimes(2);
    expect(TestBed.inject(Router).url).toBe('/events/event-1/edit');
    expect(queryClient.getQueryState(detailKey)?.status).toBe('error');
    expect(editor['eventForm']().submitting()).toBe(false);
    expect(editor['eventModel']().title).toBe('Saved current event');
    expect(editor['eventModel']().registrationOptions[0]?.title).toBe(
      'Browser retained attendee',
    );
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'The event was saved, but its latest details could not be loaded.',
    );
    expect(root.textContent).not.toContain('Private destination read failure');
  });
});
