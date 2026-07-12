import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tenant } from '../../../types/custom/tenant';

import { ConfigService } from '../../core/config.service';
import { EventGeneralForm } from '../../shared/components/forms/event-general-form/event-general-form';
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
        formInvalid: false,
        formSubmitting: false,
        legacyRandomBlocked: false,
        mutationPending: false,
      }),
    ).toBe(false);
    expect(
      templateCreateEventSubmitDisabled({
        formInvalid: true,
        formSubmitting: false,
        legacyRandomBlocked: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      templateCreateEventSubmitDisabled({
        formInvalid: false,
        formSubmitting: true,
        legacyRandomBlocked: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      templateCreateEventSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        legacyRandomBlocked: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      templateCreateEventSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        legacyRandomBlocked: true,
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
    expect(legacyRandomTemplateEventMessage).toContain(
      'cannot be created from it until',
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
  it('preserves actionable failures and falls back for unknown errors', () => {
    expect(
      templateCreateEventErrorMessage(
        new Error(
          'Registration option does not belong to the selected template',
        ),
      ),
    ).toBe('Registration option does not belong to the selected template');
    expect(templateCreateEventErrorMessage({})).toBe(
      'The event could not be created. Review the form and try again.',
    );
  });
});

const createEvent = vi.fn();
const findTemplate = vi.fn();

const normalizeText = (
  fixture: ComponentFixture<TemplateCreateEventComponent>,
) => fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('TemplateCreateEventComponent load recovery', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    createEvent.mockReset();
    createEvent.mockResolvedValue({ id: 'event-1' });
    findTemplate.mockReset();
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
            tenantSignal: signal<null | Tenant>(null),
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
              queryFn: async () => [],
              queryKey: ['discount-providers'],
            }),
            eventListFilter: () => ({ queryKey: ['events'] }),
            findTemplate: (id: string) => ({
              queryFn: findTemplate,
              queryKey: ['template', id],
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
    expect(alert?.textContent).toContain('Event could not be created');
    expect(alert?.textContent).toContain(
      'Registration option does not belong to the selected template',
    );
    expect(alert?.textContent).toContain('Your entries are still here.');
    expect(alert?.textContent).toContain(
      'Legacy random allocation must be changed on the template before trying again.',
    );
    expect(titleInput.value).toBe('Retained workshop');

    const retryButton = root.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(retryButton?.textContent?.trim()).toBe('Create event');
    expect(retryButton?.disabled).toBe(false);
  });
});
