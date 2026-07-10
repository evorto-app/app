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
import {
  legacyRandomTemplateEventMessage,
  templateAddOnCopyNotice,
  TemplateCreateEventComponent,
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

const findTemplate = vi.fn();

const normalizeText = (
  fixture: ComponentFixture<TemplateCreateEventComponent>,
) => fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('TemplateCreateEventComponent load recovery', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    findTemplate.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
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
              mutationFn: async () => ({ id: 'event-1' }),
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
});
