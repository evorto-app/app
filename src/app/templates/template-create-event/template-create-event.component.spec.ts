import type { DiscountProviderRecord } from '@shared/rpc-contracts/app-rpcs/discounts.rpcs';
import type { TaxRatesListActiveRecord } from '@shared/rpc-contracts/app-rpcs/tax-rates.rpcs';
import type { TemplateFindOneRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  createRpcQueryFilter,
  createRpcQueryKey,
} from '@heddendorp/effect-angular-query';
import {
  RpcBadRequestError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import { ClientTenantConfig } from '@shared/rpc-contracts/app-rpcs/config.rpcs';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { QueryObserver } from '@tanstack/query-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { EventGeneralForm } from '../../shared/components/forms/event-general-form/event-general-form';
import { RegistrationOptionForm } from '../../shared/components/forms/registration-option-form/registration-option-form';
import {
  legacyRandomTemplateEventMessage,
  templateAddOnCopyNotice,
  TemplateCreateEventComponent,
  templateCreateEventErrorMessage,
  TemplateCreateEventOperations,
  templateCreateEventSubmitDisabled,
  templateHasLegacyRandomRegistration,
} from './template-create-event.component';

describe('templateCreateEventSubmitDisabled', () => {
  it('blocks template event creation while invalid, submitting, or awaiting the mutation', () => {
    expect(
      templateCreateEventSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: false,
        legacyRandomBlocked: false,
        mutationPending: false,
        paidGraphBlocked: false,
        taxRatesReady: true,
      }),
    ).toBe(false);
    expect(
      templateCreateEventSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: true,
        formSubmitting: false,
        legacyRandomBlocked: false,
        mutationPending: false,
        paidGraphBlocked: false,
        taxRatesReady: true,
      }),
    ).toBe(true);
    expect(
      templateCreateEventSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: true,
        legacyRandomBlocked: false,
        mutationPending: false,
        paidGraphBlocked: false,
        taxRatesReady: true,
      }),
    ).toBe(true);
    expect(
      templateCreateEventSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: false,
        legacyRandomBlocked: false,
        mutationPending: true,
        paidGraphBlocked: false,
        taxRatesReady: true,
      }),
    ).toBe(true);
    expect(
      templateCreateEventSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: false,
        legacyRandomBlocked: true,
        mutationPending: false,
        paidGraphBlocked: false,
        taxRatesReady: true,
      }),
    ).toBe(true);
  });
  it.each([
    {
      discountProvidersReady: false,
      paidGraphBlocked: false,
      taxRatesReady: true,
    },
    {
      discountProvidersReady: true,
      paidGraphBlocked: true,
      taxRatesReady: true,
    },
    {
      discountProvidersReady: true,
      paidGraphBlocked: false,
      taxRatesReady: false,
    },
  ])('blocks unavailable pricing prerequisites: %j', (pricing) => {
    expect(
      templateCreateEventSubmitDisabled({
        ...pricing,
        formInvalid: false,
        formSubmitting: false,
        legacyRandomBlocked: false,
        mutationPending: false,
      }),
    ).toBe(true);
  });
});

describe('template legacy random allocation guard', () => {
  it('blocks event creation without coercing the template mode', () => {
    const registrationOptions = [
      { registrationMode: 'fcfs' },
      { registrationMode: 'random' },
    ];
    expect(templateHasLegacyRandomRegistration(registrationOptions)).toBe(true);
    expect(registrationOptions[1]?.registrationMode).toBe('random');
    expect(legacyRandomTemplateEventMessage).toBe(
      'Random allocation is unavailable. An authorized template editor must choose First come, first served or Manual approval before anyone can create an event from this template.',
    );
    expect(
      templateHasLegacyRandomRegistration([
        { registrationMode: 'fcfs' },
        { registrationMode: 'application' },
      ]),
    ).toBe(false);
  });
});

describe('templateAddOnCopyNotice', () => {
  it('stays hidden when a template has no reusable add-ons', () => {
    expect(templateAddOnCopyNotice(0)).toBeNull();
  });

  it('keeps the create-event add-on boundary explicit', () => {
    expect(templateAddOnCopyNotice(1)).toContain(
      'This template has 1 reusable add-on.',
    );
    expect(templateAddOnCopyNotice(2)).toContain(
      'Event creation copies them to event registration cards',
    );
    expect(templateAddOnCopyNotice(2)).toContain('registration-time purchase');
  });
});

describe('templateCreateEventErrorMessage', () => {
  it('preserves a typed event validation reason', () => {
    expect(
      templateCreateEventErrorMessage({
        _tag: 'RpcBadRequestError',
        message: 'Registration option does not belong to the selected template',
      }),
    ).toBe('Registration option does not belong to the selected template');
  });

  it('uses a safe fallback for unrecognized failures', () => {
    expect(
      templateCreateEventErrorMessage(
        new Error(
          'Registration option does not belong to the selected template',
        ),
      ),
    ).toBe(
      'The event creation outcome could not be confirmed. Open the event list, load the page again and check for this event before trying again.',
    );
    expect(templateCreateEventErrorMessage({})).toBe(
      'The event creation outcome could not be confirmed. Open the event list, load the page again and check for this event before trying again.',
    );
  });
});

const createEvent = vi.fn();
const findTaxRates = vi.fn(
  async (): Promise<readonly TaxRatesListActiveRecord[]> => [],
);
const findDiscountProviders = vi.fn(
  async (): Promise<readonly DiscountProviderRecord[]> => [],
);
const findTemplate = vi.fn();

const templateWithoutOptions = {
  addOns: [],
  categoryId: 'category-1',
  description: '<p>Template</p>',
  icon: {
    iconColor: 2,
    iconName: 'calendar:fas',
  },
  id: 'template-1',
  location: null,
  planningTips: null,
  questions: [],
  registrationOptions: [],
  title: 'Weekly meetup',
} as const;

const tenantConfig = new ClientTenantConfig({
  cancellationDeadlineHoursBeforeStart: 24,
  currency: 'EUR',
  defaultLocation: undefined,
  discountProviders: {
    esnCard: {
      config: {},
      status: 'disabled',
    },
  },
  domain: 'tenant.example.test',
  id: 'tenant-1',
  maxActiveRegistrationsPerUser: 3,
  name: 'Tenant',
  paymentsConfigured: false,
  receiptSettings: {
    allowOther: false,
    receiptCountries: ['DE'],
  },
  refundFeesOnCancellation: false,
  theme: 'evorto',
  timezone: 'Europe/Berlin',
  transferDeadlineHoursBeforeStart: 24,
});

const normalizeText = (
  fixture: ComponentFixture<TemplateCreateEventComponent>,
) => fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('TemplateCreateEventComponent load recovery', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    createEvent.mockReset();
    createEvent.mockResolvedValue({ id: 'event-1' });
    findTemplate.mockReset();
    findTaxRates.mockReset().mockResolvedValue([]);
    findDiscountProviders.mockReset().mockResolvedValue([]);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
      },
    });

    TestBed.overrideComponent(EventGeneralForm, {
      set: {
        template: `<input data-testid="event-title" [formField]="generalForm().title" />`,
      },
    });

    TestBed.overrideComponent(RegistrationOptionForm, {
      set: {
        template: `
          <app-currency-amount-input
            label="Registration price"
            currencyCode="EUR"
            [formField]="registrationOptionForm().price"
          />
          <app-currency-amount-input
            label="ESNcard price"
            currencyCode="EUR"
            [allowEmpty]="true"
            [formField]="registrationOptionForm().esnCardDiscountedPrice"
          />
        `,
      },
    });

    await TestBed.configureTestingModule({
      imports: [TemplateCreateEventComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: ConfigService,
          useValue: {
            tenantSignal: signal<ClientTenantConfig | null>(tenantConfig),
          } satisfies Pick<ConfigService, 'tenantSignal'>,
        },
        {
          provide: TemplateCreateEventOperations,
          useValue: {
            createEvent: () => ({
              mutationFn: createEvent,
              mutationKey: ['create-event'],
            }),
            discountProviders: () => ({
              queryFn: findDiscountProviders,
              queryKey: ['discount-providers'],
            }),
            eventListFilter: () => ({ queryKey: ['events'] }),
            findTemplate: (id: string) => ({
              queryFn: findTemplate,
              queryKey: ['template', id],
            }),
            taxRates: () => ({
              queryFn: findTaxRates,
              queryKey: ['tax-rates'],
            }),
          },
        },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('announces a failed first load and retries the template query', async () => {
    findTemplate
      .mockRejectedValueOnce(new Error('Template unavailable'))
      .mockReturnValue(
        new Promise(() => {
          // Keep the retry in flight so the retry state remains observable.
        }),
      );

    const fixture = TestBed.createComponent(TemplateCreateEventComponent);
    fixture.componentRef.setInput('templateId', 'template-1');
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Template could not be loaded');
    });

    const alert: HTMLElement | null =
      fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      'The event form cannot be prepared until the selected template is available.',
    );
    expect(normalizeText(fixture)).toContain('Create event');

    const retryButton: HTMLButtonElement | null =
      alert?.querySelector('button') ?? null;
    expect(retryButton?.textContent?.trim()).toBe('Try again');
    retryButton?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findTemplate).toHaveBeenCalledTimes(2);
    });
  });

  it('announces a failed submission while retaining entries and enabling retry', async () => {
    findTemplate.mockResolvedValue({
      addOns: [],
      categoryId: 'category-1',
      description: '<p>Template</p>',
      icon: {
        iconColor: 2,
        iconName: 'calendar:fas',
      },
      id: 'template-1',
      location: null,
      planningTips: null,
      questions: [],
      registrationOptions: [],
      title: 'Weekly meetup',
    });
    createEvent.mockRejectedValueOnce(
      new Error('Registration option does not belong to the selected template'),
    );

    const fixture = TestBed.createComponent(TemplateCreateEventComponent);
    fixture.componentRef.setInput('templateId', 'template-1');
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        root.querySelector<HTMLInputElement>(
          ':scope [data-testid="event-title"]',
        ),
      ).not.toBeNull();
    });
    const titleInput = root.querySelector<HTMLInputElement>(
      ':scope [data-testid="event-title"]',
    );
    if (!titleInput) {
      throw new Error('Expected the event title input to render.');
    }
    titleInput.value = 'Retained workshop';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    const form = root.querySelector<HTMLFormElement>('form');
    expect(form).not.toBeNull();
    form?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(createEvent).toHaveBeenCalledOnce();
      expect(root.querySelector('[role="alert"]')).not.toBeNull();
    });

    const alert = root.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain('Review event creation');
    expect(alert?.textContent).toContain(
      'The event creation outcome could not be confirmed. Open the event list, load the page again and check for this event before trying again.',
    );
    expect(alert?.textContent).toContain('Your entries are still here.');
    expect(alert?.textContent).not.toContain('Random allocation');
    expect(titleInput.value).toBe('Retained workshop');

    const retryButton = root.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(retryButton?.textContent?.trim()).toBe('Create event');
    expect(retryButton?.disabled).toBe(false);
  });

  const renderForSubmission = async () => {
    findTemplate.mockResolvedValue(templateWithoutOptions);
    const fixture = TestBed.createComponent(TemplateCreateEventComponent);
    fixture.componentRef.setInput('templateId', 'template-1');
    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement)) throw new Error('Expected event form');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.querySelector('[data-testid="event-title"]')).not.toBeNull();
    });
    const title = root.querySelector<HTMLInputElement>(
      '[data-testid="event-title"]',
    );
    const form = root.querySelector('form');
    if (!title || !form)
      throw new Error('Expected editable event title and form');
    title.value = 'My retained event';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        root.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(false);
    });
    return { fixture, form, root, title };
  };

  it.each([
    { error: new Error('Response was lost'), label: 'transport' },
    {
      error: new RpcInternalServerError({ message: 'Private exception' }),
      label: 'internal',
    },
  ])(
    'explains an unconfirmed $label creation without replaying the submitted event',
    async ({ error }) => {
      let simulatedServerCommit = false;
      createEvent.mockImplementationOnce(async () => {
        simulatedServerCommit = true;
        throw error;
      });
      const { fixture, form, root, title } = await renderForSubmission();
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(root.textContent).toContain(
          'The event creation outcome could not be confirmed.',
        );
      });
      expect(simulatedServerCommit).toBe(true);
      expect(createEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ title: 'My retained event' }),
        expect.objectContaining({ client: queryClient }),
      );
      expect(title.value).toBe('My retained event');
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    },
  );

  it('retains the expected validation explanation after a rejected creation', async () => {
    createEvent.mockRejectedValueOnce(
      new RpcBadRequestError({ message: 'Choose a future start time.' }),
    );
    const { fixture, form, root, title } = await renderForSubmission();
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.textContent).toContain('Choose a future start time.');
    });
    expect(createEvent).toHaveBeenCalledOnce();
    expect(title.value).toBe('My retained event');
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
  });

  it('keeps confirmed creation visible when the real active event-list query fails', async () => {
    const loadEvents = vi.fn(async () => ['existing-event']);
    const observer = new QueryObserver(queryClient, {
      queryFn: loadEvents,
      queryKey: ['events', 'list'],
    });
    const unsubscribe = observer.subscribe(() => {
      // Keep the real event-list query active for the mutation invalidation.
    });
    try {
      await observer.refetch({ throwOnError: true });
      loadEvents.mockRejectedValueOnce(new Error('List read failed'));
      const { fixture, form, root, title } = await renderForSubmission();
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(root.textContent).toContain(
          'The event was created, but the event list could not be updated.',
        );
      });
      expect(queryClient.getQueryState(['events', 'list'])?.status).toBe(
        'error',
      );
      expect(createEvent).toHaveBeenCalledOnce();
      expect(title.value).toBe('My retained event');
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it.each(['rejected', 'cancelled'] as const)(
    'keeps confirmed creation visible after %s navigation',
    async (outcome) => {
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      if (outcome === 'rejected')
        navigate.mockRejectedValueOnce(new Error('Navigation failed'));
      else navigate.mockResolvedValueOnce(false);
      const { fixture, form, root, title } = await renderForSubmission();
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(root.textContent).toContain(
          'The event was created, but its page could not be opened.',
        );
      });
      expect(createEvent).toHaveBeenCalledOnce();
      expect(navigate).toHaveBeenCalledExactlyOnceWith(['/events', 'event-1']);
      expect(title.value).toBe('My retained event');
    },
  );

  it('keeps submission disabled until the confirmed event finishes opening', async () => {
    let finishNavigation: ((opened: boolean) => void) | undefined;
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const navigation = new Promise<boolean>((resolve) => {
      finishNavigation = resolve;
    });
    vi.mocked(TestBed.inject(Router).navigate).mockReturnValueOnce(navigation);
    const { fixture, form, root, title } = await renderForSubmission();
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    try {
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(TestBed.inject(Router).navigate).toHaveBeenCalledOnce();
        expect(
          root.querySelector<HTMLButtonElement>('button[type="submit"]')
            ?.disabled,
        ).toBe(true);
      });
      await fixture.componentInstance.onSubmit(
        new Event('submit', { cancelable: true }),
      );
      expect(createEvent).toHaveBeenCalledOnce();
      expect(title.value).toBe('My retained event');
    } finally {
      finishNavigation?.(true);
      await fixture.whenStable();
    }
  });
  it.each([
    {
      failureText: 'Discount settings could not be loaded.',
      query: findDiscountProviders,
    },
    {
      failureText: 'Tax rates could not be loaded.',
      query: findTaxRates,
    },
  ])('blocks creation until $failureText can be retried', async (scenario) => {
    findTemplate.mockResolvedValue(templateWithoutOptions);
    scenario.query
      .mockRejectedValueOnce(new Error(scenario.failureText))
      .mockResolvedValue([]);

    const fixture = TestBed.createComponent(TemplateCreateEventComponent);
    fixture.componentRef.setInput('templateId', 'template-1');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(scenario.failureText);
    });

    const alert = [
      ...root.querySelectorAll<HTMLElement>('[role="alert"]'),
    ].find((element) => element.textContent?.includes(scenario.failureText));
    expect(
      root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    ).toBe(true);
    alert?.querySelector<HTMLButtonElement>('button')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(scenario.query).toHaveBeenCalledTimes(2);
      expect(normalizeText(fixture)).not.toContain(scenario.failureText);
    });
  });

  it.each([
    {
      blocked: true,
      label: 'paid add-on only without payments',
      paidAddOn: true,
      paidOption: false,
      paymentsConfigured: false,
    },
    {
      blocked: false,
      label: 'paid add-on only with payments',
      paidAddOn: true,
      paidOption: false,
      paymentsConfigured: true,
    },
    {
      blocked: false,
      label: 'unpaid graph without payments',
      paidAddOn: false,
      paidOption: false,
      paymentsConfigured: false,
    },
    {
      blocked: false,
      label: 'unpaid graph with payments',
      paidAddOn: false,
      paidOption: false,
      paymentsConfigured: true,
    },
    {
      blocked: true,
      label: 'mixed paid graph without payments',
      paidAddOn: true,
      paidOption: true,
      paymentsConfigured: false,
    },
    {
      blocked: false,
      label: 'mixed paid graph with payments',
      paidAddOn: true,
      paidOption: true,
      paymentsConfigured: true,
    },
  ])(
    'guards the rendered form and direct submission for $label without changing prices',
    async ({ blocked, paidAddOn, paidOption, paymentsConfigured }) => {
      TestBed.inject(ConfigService).tenantSignal.set(
        new ClientTenantConfig({ ...tenantConfig, paymentsConfigured }),
      );
      const taxRates: readonly TaxRatesListActiveRecord[] = [
        {
          country: 'DE',
          displayName: 'VAT',
          id: 'tax-rate-1',
          percentage: '19',
          state: null,
          stripeTaxRateId: 'txr_19',
        },
      ];
      findTaxRates.mockResolvedValue(paymentsConfigured ? taxRates : []);
      const registrationPrice = paidOption ? 1500 : 0;
      const template: TemplateFindOneRecord = {
        ...templateWithoutOptions,
        addOns: [
          {
            allowMultiple: false,
            allowPurchaseBeforeEvent: false,
            allowPurchaseDuringEvent: false,
            allowPurchaseDuringRegistration: true,
            description: 'Copied to the new event.',
            id: 'template-addon-1',
            isPaid: paidAddOn,
            maxQuantityPerUser: 1,
            price: paidAddOn ? 875 : 0,
            registrationOptions: [
              {
                includedQuantity: 0,
                optionalPurchaseQuantity: 1,
                registrationOptionId: 'template-option-1',
              },
            ],
            stripeTaxRateId: paidAddOn ? 'txr_19' : null,
            title: 'Workshop kit',
            totalAvailableQuantity: 10,
          },
        ],
        registrationOptions: [
          {
            cancellationDeadlineHoursBeforeStart: null,
            closeRegistrationOffset: 24,
            description: null,
            esnCardDiscountedPrice: null,
            id: 'template-option-1',
            isPaid: paidOption,
            openRegistrationOffset: 168,
            organizingRegistration: false,
            price: registrationPrice,
            refundFeesOnCancellation: null,
            registeredDescription: null,
            registrationMode: 'fcfs',
            roleIds: [],
            roles: [],
            spots: 10,
            stripeTaxRateId: paidOption ? 'txr_19' : null,
            title: 'Participant',
            transferDeadlineHoursBeforeStart: null,
          },
        ],
      };
      const originalTemplate = structuredClone(template);
      findTemplate.mockResolvedValue(template);

      const fixture = TestBed.createComponent(TemplateCreateEventComponent);
      fixture.componentRef.setInput('templateId', template.id);
      const root: HTMLElement = fixture.nativeElement;
      await vi.waitFor(() => {
        fixture.detectChanges();
        for (const queryKey of [
          ['template', template.id],
          ['discount-providers'],
          ['tax-rates'],
        ]) {
          expect(queryClient.getQueryState(queryKey)?.status).toBe('success');
          expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('idle');
        }
        const priceInput = root.querySelector<HTMLInputElement>(
          '[aria-label="Registration price (EUR)"]',
        );
        if (paidOption) {
          expect(priceInput?.value).toBe('15');
        } else {
          expect(priceInput).toBeNull();
        }
      });

      const submitButton = root.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      if (!submitButton) throw new Error('Expected the create event button.');
      expect(submitButton.disabled).toBe(blocked);
      const paymentAlert = root.querySelector<HTMLElement>('[role="alert"]');
      if (blocked) {
        expect(paymentAlert?.textContent?.replaceAll(/\s+/g, ' ').trim()).toBe(
          'This template contains paid registration options or add-ons. Their prices remain unchanged. The event cannot be created until this organization has a connected Stripe account.',
        );
      } else {
        expect(paymentAlert).toBeNull();
      }
      expect(normalizeText(fixture)).toContain(
        'This template has 1 reusable add-on.',
      );

      await fixture.componentInstance.onSubmit(
        new Event('submit', { cancelable: true }),
      );
      if (blocked) {
        expect(createEvent).not.toHaveBeenCalled();
      } else {
        await vi.waitFor(() => {
          expect(createEvent).toHaveBeenCalledOnce();
          expect(createEvent.mock.calls[0]?.[0]).toMatchObject({
            registrationOptions: [
              {
                isPaid: paidOption,
                price: registrationPrice,
                sourceTemplateRegistrationOptionId: 'template-option-1',
                stripeTaxRateId: paidOption ? 'txr_19' : null,
              },
            ],
            templateId: template.id,
          });
          expect(createEvent.mock.calls[0]?.[0]).not.toHaveProperty('addOns');
        });
      }
      fixture.detectChanges();
      const priceInput = root.querySelector<HTMLInputElement>(
        '[aria-label="Registration price (EUR)"]',
      );
      if (paidOption) {
        expect(priceInput?.value).toBe('15');
      } else {
        expect(priceInput).toBeNull();
      }
      expect(queryClient.getQueryData(['template', template.id])).toEqual(
        originalTemplate,
      );
    },
  );

  it.each([
    { enteredPrice: '3', expectedPrice: 300, label: 'edited amount' },
    { enteredPrice: '', expectedPrice: null, label: 'explicit removal' },
    { enteredPrice: '0', expectedPrice: 0, label: 'zero price' },
  ])(
    'submits the $label shown in the event discount form',
    async ({ enteredPrice, expectedPrice }) => {
      TestBed.inject(ConfigService).tenantSignal.set(
        new ClientTenantConfig({ ...tenantConfig, paymentsConfigured: true }),
      );
      findDiscountProviders.mockResolvedValue([
        { config: {}, status: 'enabled', type: 'esnCard' },
      ]);
      findTemplate.mockResolvedValue({
        ...templateWithoutOptions,
        registrationOptions: [
          {
            cancellationDeadlineHoursBeforeStart: null,
            closeRegistrationOffset: 24,
            description: null,
            esnCardDiscountedPrice: 500,
            id: 'template-option-1',
            isPaid: true,
            openRegistrationOffset: 168,
            organizingRegistration: false,
            price: 1000,
            refundFeesOnCancellation: null,
            registeredDescription: null,
            registrationMode: 'fcfs',
            roleIds: [],
            roles: [],
            spots: 10,
            stripeTaxRateId: 'txr_19',
            title: 'Participant',
            transferDeadlineHoursBeforeStart: null,
          },
        ],
      } satisfies TemplateFindOneRecord);

      const fixture = TestBed.createComponent(TemplateCreateEventComponent);
      fixture.componentRef.setInput('templateId', 'template-1');
      const root: HTMLElement = fixture.nativeElement;
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(
          root.querySelector<HTMLInputElement>(
            '[aria-label="ESNcard price (EUR)"]',
          )?.value,
        ).toBe('5');
        expect(
          root.querySelector<HTMLButtonElement>('button[type="submit"]')
            ?.disabled,
        ).toBe(false);
      });
      const priceInput = root.querySelector<HTMLInputElement>(
        '[aria-label="ESNcard price (EUR)"]',
      );
      if (!priceInput) throw new Error('Expected the ESNcard price input.');
      priceInput.value = enteredPrice;
      priceInput.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      root
        .querySelector<HTMLFormElement>('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );

      await vi.waitFor(() => {
        expect(createEvent).toHaveBeenCalledOnce();
        expect(createEvent.mock.calls[0]?.[0]).toMatchObject({
          registrationOptions: [
            {
              esnCardDiscountedPrice: expectedPrice,
              sourceTemplateRegistrationOptionId: 'template-option-1',
            },
          ],
        });
      });
    },
  );

  it('keeps event creation locked until all active list reads settle after one fails', async () => {
    let finishSibling: ((value: string[]) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const siblingRead = new Promise<string[]>((resolve) => {
      finishSibling = resolve;
    });
    const loadFailedList = vi.fn(async () => ['existing-event']);
    const loadHeldList = vi.fn(async () => ['related-event']);
    const eventListFilter = createRpcQueryFilter(['events', 'eventList']);
    const filterSpy = vi
      .spyOn(TestBed.inject(TemplateCreateEventOperations), 'eventListFilter')
      .mockReturnValue(eventListFilter);
    const failedKey = createRpcQueryKey(['events', 'eventList'], {
      input: { limit: 20, offset: 0 },
      type: 'query',
    });
    const heldKey = createRpcQueryKey(['events', 'eventList'], {
      input: { limit: 20, offset: 20 },
      type: 'query',
    });
    const unrelatedKey = createRpcQueryKey(['events', 'findOne'], {
      input: { id: 'other-event' },
      type: 'query',
    });
    const loadUnrelatedEvent = vi.fn(async () => 'other-event');
    const unrelatedObserver = new QueryObserver(queryClient, {
      queryFn: loadUnrelatedEvent,
      queryKey: unrelatedKey,
    });
    let unrelatedStatus = 'pending';
    const unsubscribeUnrelated = unrelatedObserver.subscribe((result) => {
      unrelatedStatus = result.status;
    });
    const failedObserver = new QueryObserver(queryClient, {
      queryFn: loadFailedList,
      queryKey: failedKey,
    });
    const heldObserver = new QueryObserver(queryClient, {
      queryFn: loadHeldList,
      queryKey: heldKey,
    });
    let failedListStatus = 'pending';
    let heldListStatus = 'pending';
    const unsubscribeFailed = failedObserver.subscribe((result) => {
      failedListStatus = result.status;
    });
    const unsubscribeHeld = heldObserver.subscribe((result) => {
      heldListStatus = result.status;
    });
    let submission: Promise<void> | undefined;
    try {
      await vi.waitFor(() => {
        expect(failedListStatus).toBe('success');
        expect(heldListStatus).toBe('success');
        expect(unrelatedStatus).toBe('success');
      });
      const { fixture, form, root, title } = await renderForSubmission();
      const model = fixture.componentInstance['createEventModel']();
      const modelSnapshot = JSON.stringify(model);
      const expectedPayload = {
        description: '<p>Template</p>',
        end: model.end.toJSDate().toISOString(),
        icon: { iconColor: 2, iconName: 'calendar:fas' },
        location: null,
        registrationOptions: [],
        start: model.start.toJSDate().toISOString(),
        templateId: 'template-1',
        title: 'My retained event',
      };
      const invalidation = vi.spyOn(queryClient, 'invalidateQueries');
      loadFailedList.mockRejectedValueOnce(
        new Error('First active list failed'),
      );
      loadHeldList.mockReturnValueOnce(siblingRead);
      submission = fixture.componentInstance.onSubmit(
        new Event('submit', { cancelable: true }),
      );
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(loadHeldList).toHaveBeenCalledTimes(2);
        expect(queryClient.getQueryState(failedKey)?.status).toBe('error');
        expect(queryClient.getQueryState(heldKey)?.fetchStatus).toBe(
          'fetching',
        );
        expect(
          fixture.componentInstance['createEventMutation'].isPending(),
        ).toBe(false);
        expect(
          fixture.componentInstance['createEventForm']().submitting(),
        ).toBe(true);
      });
      const createButton = root.querySelector('button[type="submit"]');
      if (!(createButton instanceof HTMLButtonElement))
        throw new TypeError('Expected create button');
      expect(createButton.disabled).toBe(true);
      expect(form.getAttribute('aria-busy')).toBe('true');
      expect(root.querySelector('[role="alert"]')).toBeNull();
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await fixture.componentInstance.onSubmit(
        new Event('submit', { cancelable: true }),
      );
      expect(createEvent).toHaveBeenCalledOnce();
      expect(fixture.componentInstance['createEventForm']().submitting()).toBe(
        true,
      );
      if (!finishSibling) throw new Error('Expected an owned active list read');
      finishSibling(['related-event']);
      await submission;
      fixture.detectChanges();
      expect(createButton.disabled).toBe(false);
      expect(form.getAttribute('aria-busy')).toBe('false');
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(
        'The event was created, but the event list could not be updated. Open the event list and load the page again to see it.',
      );
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
      expect(createEvent).toHaveBeenCalledOnce();
      expect(invalidation).toHaveBeenCalledExactlyOnceWith(eventListFilter, {
        throwOnError: true,
      });
      expect(filterSpy).toHaveBeenCalledOnce();
      expect(loadUnrelatedEvent).toHaveBeenCalledOnce();
      expect(loadFailedList).toHaveBeenCalledTimes(2);
      expect(loadHeldList).toHaveBeenCalledTimes(2);
      expect(
        JSON.stringify(fixture.componentInstance['createEventModel']()),
      ).toBe(modelSnapshot);
      expect(title.value).toBe('My retained event');
      const payload: unknown = createEvent.mock.calls[0]?.[0];
      if (payload === undefined)
        throw new Error('Expected the submitted event payload');
      const serializedPayload = JSON.stringify(payload);
      const publicPayload: unknown = JSON.parse(serializedPayload);
      expect(publicPayload).toEqual(expectedPayload);
    } finally {
      finishSibling?.(['released']);
      try {
        await submission;
      } finally {
        try {
          unsubscribeFailed();
        } finally {
          try {
            unsubscribeHeld();
          } finally {
            unsubscribeUnrelated();
          }
        }
      }
    }
  });

  it('does not wait for an inactive matching list read when creating the event', async () => {
    const { fixture, form, root, title } = await renderForSubmission();
    const modelSnapshot = JSON.stringify(
      fixture.componentInstance['createEventModel'](),
    );
    const invalidation = vi.spyOn(queryClient, 'invalidateQueries');
    let finishInactive: ((value: string[]) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const heldInactive = new Promise<string[]>((resolve) => {
      finishInactive = resolve;
    });
    const eventListFilter = createRpcQueryFilter(['events', 'eventList']);
    const filterSpy = vi
      .spyOn(TestBed.inject(TemplateCreateEventOperations), 'eventListFilter')
      .mockReturnValue(eventListFilter);
    const inactiveKey = createRpcQueryKey(['events', 'eventList'], {
      input: { limit: 20, offset: 40 },
      type: 'query',
    });
    const loadInactive = vi.fn(() => heldInactive);
    const inactiveRead = queryClient.fetchQuery({
      queryFn: loadInactive,
      queryKey: inactiveKey,
    });
    let submission: Promise<void> | undefined;
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
      submission = fixture.componentInstance.onSubmit(
        new Event('submit', { cancelable: true }),
      );
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(TestBed.inject(Router).navigate).toHaveBeenCalledExactlyOnceWith(
          ['/events', 'event-1'],
        );
        expect(
          fixture.componentInstance['createEventForm']().submitting(),
        ).toBe(false);
      });
      const createButton = root.querySelector('button[type="submit"]');
      if (!(createButton instanceof HTMLButtonElement))
        throw new TypeError('Expected create button');
      expect(createButton.disabled).toBe(false);
      expect(form.getAttribute('aria-busy')).toBe('false');
      expect(root.querySelector('[role="alert"]')).toBeNull();
      expect(queryClient.getQueryState(inactiveKey)?.fetchStatus).toBe(
        'fetching',
      );
      expect(loadInactive).toHaveBeenCalledOnce();
      expect(createEvent).toHaveBeenCalledOnce();
      expect(invalidation).toHaveBeenCalledExactlyOnceWith(eventListFilter, {
        throwOnError: true,
      });
      expect(filterSpy).toHaveBeenCalledOnce();
      expect(
        JSON.stringify(fixture.componentInstance['createEventModel']()),
      ).toBe(modelSnapshot);
      expect(title.value).toBe('My retained event');
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
