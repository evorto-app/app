import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientTenantConfig } from '../../../shared/rpc-contracts/app-rpcs/config.rpcs';

import { ConfigService } from '../../core/config.service';
import { EventGeneralForm } from '../../shared/components/forms/event-general-form/event-general-form';
import {
  templateAddOnCopyNotice,
  TemplateCreateEventComponent,
  templateCreateEventErrorMessage,
  TemplateCreateEventOperations,
  templateCreateEventSubmitDisabled,
} from './template-create-event.component';

describe('templateCreateEventSubmitDisabled', () => {
  it('uses payment readiness without reading the payment account identifier', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/templates/template-create-event/template-create-event.component.ts',
      ),
      'utf8',
    );

    expect(source).toContain('paymentsConfigured');
    expect(source).not.toContain('stripeAccountId');
  });

  it('blocks template event creation while invalid, submitting, or awaiting the mutation', () => {
    expect(
      templateCreateEventSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: false,
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
        mutationPending: true,
        paidGraphBlocked: false,
        taxRatesReady: true,
      }),
    ).toBe(true);
  });

  it('blocks unresolved discount settings and paid graphs without rewriting them', () => {
    expect(
      templateCreateEventSubmitDisabled({
        discountProvidersReady: false,
        formInvalid: false,
        formSubmitting: false,
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
        mutationPending: false,
        paidGraphBlocked: true,
        taxRatesReady: true,
      }),
    ).toBe(true);
    expect(
      templateCreateEventSubmitDisabled({
        discountProvidersReady: true,
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
        paidGraphBlocked: false,
        taxRatesReady: false,
      }),
    ).toBe(true);
  });
});

describe('templateAddOnCopyNotice', () => {
  it('stays hidden when a template has no reusable add-ons', () => {
    expect(templateAddOnCopyNotice(0)).toBeNull();
  });

  it('explains that template add-ons will be available on the event', () => {
    expect(templateAddOnCopyNotice(1)).toContain(
      'This template includes 1 add-on.',
    );
    expect(templateAddOnCopyNotice(2)).toContain(
      'They will be available when people sign up for the new event.',
    );
  });
});

describe('templateCreateEventErrorMessage', () => {
  it('shows form corrections without exposing internal failures', () => {
    expect(
      templateCreateEventErrorMessage({
        _tag: 'RpcBadRequestError',
        message: 'Choose an event end time after its start time.',
      }),
    ).toBe('Choose an event end time after its start time.');
    expect(
      templateCreateEventErrorMessage(
        new Error(
          'Registration option does not belong to the selected template',
        ),
      ),
    ).toBe(
      'The event could not be created. Check the event details and try again.',
    );
    expect(templateCreateEventErrorMessage({})).toBe(
      'The event could not be created. Check the event details and try again.',
    );
  });
});

const createEvent = vi.fn();
const findDiscountProviders = vi.fn();
const findTemplate = vi.fn();
const findTaxRates = vi.fn();

const normalizeText = (
  fixture: ComponentFixture<TemplateCreateEventComponent>,
) => fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('TemplateCreateEventComponent load recovery', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    createEvent.mockReset();
    createEvent.mockResolvedValue({ id: 'event-1' });
    findDiscountProviders.mockReset();
    findDiscountProviders.mockResolvedValue([]);
    findTemplate.mockReset();
    findTaxRates.mockReset();
    findTaxRates.mockResolvedValue([]);
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

    await TestBed.configureTestingModule({
      imports: [TemplateCreateEventComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: ConfigService,
          useValue: {
            tenantSignal: signal<ClientTenantConfig | null>(null),
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
      'You cannot create this event until the selected template is available.',
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
    expect(alert?.textContent).toContain('Event could not be created');
    expect(alert?.textContent).toContain(
      'The event could not be created. Check the event details and try again.',
    );
    expect(alert?.textContent).toContain('Your entries are still here.');
    expect(titleInput.value).toBe('Retained workshop');

    const retryButton = root.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(retryButton?.textContent?.trim()).toBe('Create event');
    expect(retryButton?.disabled).toBe(false);
  });

  it('surfaces unavailable discount settings and blocks creation until retry succeeds', async () => {
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
    findDiscountProviders
      .mockRejectedValueOnce(new Error('Discount settings unavailable'))
      .mockResolvedValue([]);

    const fixture = TestBed.createComponent(TemplateCreateEventComponent);
    fixture.componentRef.setInput('templateId', 'template-1');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(
        'Discount settings could not be loaded.',
      );
    });
    const alert = [
      ...root.querySelectorAll<HTMLElement>('[role="alert"]'),
    ].find((element) => element.textContent?.includes('Discount settings'));
    const submitButton = root.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(submitButton?.disabled).toBe(true);
    alert?.querySelector<HTMLButtonElement>('button')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findDiscountProviders).toHaveBeenCalledTimes(2);
      expect(normalizeText(fixture)).not.toContain(
        'Discount settings could not be loaded.',
      );
    });
  });

  it('surfaces unavailable tax rates and blocks creation until retry succeeds', async () => {
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
    findTaxRates
      .mockRejectedValueOnce(new Error('Tax rates unavailable'))
      .mockResolvedValue([]);

    const fixture = TestBed.createComponent(TemplateCreateEventComponent);
    fixture.componentRef.setInput('templateId', 'template-1');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(
        'Tax rates could not be loaded.',
      );
    });
    const alert = [
      ...root.querySelectorAll<HTMLElement>('[role="alert"]'),
    ].find((element) => element.textContent?.includes('Tax rates'));
    const submitButton = root.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(submitButton?.disabled).toBe(true);
    alert?.querySelector<HTMLButtonElement>('button')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findTaxRates).toHaveBeenCalledTimes(2);
      expect(normalizeText(fixture)).not.toContain(
        'Tax rates could not be loaded.',
      );
    });
  });
});
