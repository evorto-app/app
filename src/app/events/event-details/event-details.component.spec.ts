import '@angular/compiler';
import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { NotificationService } from '../../core/notification.service';
import { PermissionsService } from '../../core/permissions.service';
import { EventActiveRegistrationComponent } from '../event-active-registration/event-active-registration.component';
import {
  eventAddonPurchaseTiming,
  eventAddonsForRegistrationOption,
  eventCanEdit,
  eventCanSeeStatus,
  EventDetailsComponent,
  EventDetailsOperations,
  eventRegistrationOptionGroups,
  eventRegistrationOptionTitle,
  eventReviewActionDisabled,
  eventSubmitForReviewActionDisabled,
  outgoingRegistrationTransferCopy,
  registrationOptionsState,
} from './event-details.component';

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(process.cwd(), sourcePath), 'utf8');

describe('registrationOptionsState', () => {
  it('shows available registration options when at least one option is visible', () => {
    expect(
      registrationOptionsState({
        registrationOptions: [{}],
        registrationOptionsHiddenByEligibility: false,
      }),
    ).toBe('visible');
  });

  it('shows an explicit ineligible state when every option is hidden by role eligibility', () => {
    expect(
      registrationOptionsState({
        registrationOptions: [],
        registrationOptionsHiddenByEligibility: true,
      }),
    ).toBe('hiddenByEligibility');
  });

  it('keeps optionless events distinct from role-ineligible events', () => {
    expect(
      registrationOptionsState({
        registrationOptions: [],
        registrationOptionsHiddenByEligibility: false,
      }),
    ).toBe('none');
  });
});

describe('outgoingRegistrationTransferCopy', () => {
  it.each([
    {
      expectedNextStep: 'No action is needed.',
      expectedTitle: 'Transfer refund completed',
      refundStatus: 'completed' as const,
      tone: 'success',
    },
    {
      expectedNextStep: 'Contact an organizer',
      expectedTitle: 'Transfer refund needs attention',
      refundStatus: 'needsAttention' as const,
      tone: 'error',
    },
    {
      expectedNextStep: 'No action is needed.',
      expectedTitle: 'Ticket transfer completed',
      refundStatus: 'notRequired' as const,
      tone: 'success',
    },
    {
      expectedNextStep: 'No action is needed.',
      expectedTitle: 'Transfer refund is processing',
      refundStatus: 'processing' as const,
      tone: 'info',
    },
  ])(
    'explains the $refundStatus source-owner outcome with a next step',
    ({ expectedNextStep, expectedTitle, refundStatus, tone }) => {
      const copy = outgoingRegistrationTransferCopy({ refundStatus });

      expect(copy.title).toBe(expectedTitle);
      expect(copy.nextStep).toContain(expectedNextStep);
      expect(copy.summary).toContain(
        'This transfer moved the ticket to its recipient',
      );
      expect(copy.tone).toBe(tone);
    },
  );

  it('does not equate a zero remaining refund with a free transfer', () => {
    const copy = outgoingRegistrationTransferCopy({
      refundStatus: 'notRequired',
    });

    expect(copy.summary).toContain('No refund was due for this transfer');
    expect(copy.summary).not.toContain('free transfer');
    expect(copy.summary).not.toContain('source refund');
  });

  it.each([
    {
      expectedSummary: 'one or more refunds due to you are being processed',
      refundStatus: 'processing' as const,
    },
    {
      expectedSummary:
        'one or more refunds due to you may not have reached you',
      refundStatus: 'needsAttention' as const,
    },
  ])(
    'describes mixed-payment $refundStatus states without implying a single refund',
    ({ expectedSummary, refundStatus }) => {
      expect(
        outgoingRegistrationTransferCopy({ refundStatus }).summary,
      ).toContain(expectedSummary);
    },
  );
});

describe('eventRegistrationOptionGroups', () => {
  it('keeps organizer/helper opportunities separate from participant registration options', () => {
    const organizerOption = {
      id: 'organizer-option',
      organizingRegistration: true,
    };
    const participantOption = {
      id: 'participant-option',
      organizingRegistration: false,
    };

    expect(
      eventRegistrationOptionGroups([participantOption, organizerOption]),
    ).toEqual({
      organizerOptions: [organizerOption],
      participantOptions: [participantOption],
    });
  });
});

describe('eventReviewActionDisabled', () => {
  it('allows review actions only for reviewers on pending events without an in-flight review', () => {
    expect(
      eventReviewActionDisabled({
        canReview: true,
        controlsInteractive: true,
        mutationPending: false,
        status: 'PENDING_REVIEW',
      }),
    ).toBe(false);
    expect(
      eventReviewActionDisabled({
        canReview: false,
        controlsInteractive: true,
        mutationPending: false,
        status: 'PENDING_REVIEW',
      }),
    ).toBe(true);
    expect(
      eventReviewActionDisabled({
        canReview: true,
        controlsInteractive: true,
        mutationPending: true,
        status: 'PENDING_REVIEW',
      }),
    ).toBe(true);
    expect(
      eventReviewActionDisabled({
        canReview: true,
        controlsInteractive: true,
        mutationPending: false,
        status: 'APPROVED',
      }),
    ).toBe(true);
    expect(
      eventReviewActionDisabled({
        canReview: true,
        controlsInteractive: false,
        mutationPending: false,
        status: 'PENDING_REVIEW',
      }),
    ).toBe(true);
  });
});

describe('eventSubmitForReviewActionDisabled', () => {
  it('allows only an editable draft to be submitted while no submit is pending', () => {
    expect(
      eventSubmitForReviewActionDisabled({
        canEdit: true,
        controlsInteractive: true,
        mutationPending: false,
        status: 'DRAFT',
      }),
    ).toBe(false);
    expect(
      eventSubmitForReviewActionDisabled({
        canEdit: false,
        controlsInteractive: true,
        mutationPending: false,
        status: 'DRAFT',
      }),
    ).toBe(true);
    expect(
      eventSubmitForReviewActionDisabled({
        canEdit: true,
        controlsInteractive: true,
        mutationPending: true,
        status: 'DRAFT',
      }),
    ).toBe(true);
    expect(
      eventSubmitForReviewActionDisabled({
        canEdit: true,
        controlsInteractive: true,
        mutationPending: false,
        status: 'PENDING_REVIEW',
      }),
    ).toBe(true);
    expect(
      eventSubmitForReviewActionDisabled({
        canEdit: true,
        controlsInteractive: false,
        mutationPending: false,
        status: 'DRAFT',
      }),
    ).toBe(true);
  });
});

describe('event creator lifecycle access', () => {
  it('keeps status visible after a creator submits an event without granting edit or review actions', () => {
    const canEdit = eventCanEdit({
      canEditAll: false,
      isCreator: true,
      status: 'PENDING_REVIEW',
    });

    expect(canEdit).toBe(false);
    expect(
      eventCanSeeStatus({
        canEdit,
        canReview: false,
        canSeeDrafts: false,
        isCreator: true,
      }),
    ).toBe(true);
    expect(
      eventReviewActionDisabled({
        canReview: false,
        controlsInteractive: true,
        mutationPending: false,
        status: 'PENDING_REVIEW',
      }),
    ).toBe(true);
  });
});

describe('eventAddonPurchaseTiming', () => {
  it('lists every enabled add-on purchase window in display order', () => {
    expect(
      eventAddonPurchaseTiming({
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: true,
        allowPurchaseDuringRegistration: true,
      }),
    ).toBe('During registration, Before event, During event');
  });

  it('marks add-ons without purchase windows as unavailable', () => {
    expect(
      eventAddonPurchaseTiming({
        allowPurchaseBeforeEvent: false,
        allowPurchaseDuringEvent: false,
        allowPurchaseDuringRegistration: false,
      }),
    ).toBe('Unavailable');
  });
});

describe('eventRegistrationOptionTitle', () => {
  it('resolves event-scoped add-on registration option labels', () => {
    expect(
      eventRegistrationOptionTitle(
        {
          registrationOptions: [
            {
              id: 'option-1',
              title: 'Participant',
            },
          ],
        },
        'option-1',
      ),
    ).toBe('Participant');
  });

  it('keeps copied add-ons readable when an option is no longer visible', () => {
    expect(
      eventRegistrationOptionTitle(
        {
          registrationOptions: [],
        },
        'option-1',
      ),
    ).toBe('Broken registration option configuration');
  });
});

describe('eventAddonsForRegistrationOption', () => {
  it('returns optional registration purchases and mandatory included add-ons for the selected option', () => {
    const addOns = eventAddonsForRegistrationOption(
      {
        addOns: [
          {
            allowPurchaseDuringRegistration: true,
            id: 'optional-during-registration',
            registrationOptions: [
              { includedQuantity: 0, registrationOptionId: 'option-1' },
            ],
          },
          {
            allowPurchaseDuringRegistration: false,
            id: 'included-only',
            registrationOptions: [
              { includedQuantity: 2, registrationOptionId: 'option-1' },
            ],
          },
          {
            allowPurchaseDuringRegistration: false,
            id: 'unavailable-optional',
            registrationOptions: [
              { includedQuantity: 0, registrationOptionId: 'option-1' },
            ],
          },
          {
            allowPurchaseDuringRegistration: true,
            id: 'other-option',
            registrationOptions: [
              { includedQuantity: 1, registrationOptionId: 'option-2' },
            ],
          },
        ],
      },
      'option-1',
    );

    expect(addOns.map((addOn) => addOn.id)).toEqual([
      'optional-during-registration',
      'included-only',
    ]);
  });
});

const findEvent = vi.fn();
const findRegistrationStatus = vi.fn();

const eventDetails = {
  addOns: [],
  creatorId: 'user-2',
  description: '<p>Bring a notebook.</p>',
  end: '2030-01-02T12:00:00.000Z',
  icon: { iconColor: 0xff_67_50_a4, iconName: 'calendar:fas' },
  id: 'event-1',
  location: null,
  registrationOptions: [],
  registrationOptionsHiddenByEligibility: false,
  reviewer: null,
  start: '2030-01-02T10:00:00.000Z',
  status: 'APPROVED' as const,
  statusComment: null,
  title: 'Recovery workshop',
  unlisted: false,
};

const normalizeText = (fixture: ComponentFixture<EventDetailsComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

@Component({
  selector: 'app-event-active-registration',
  template: `
    @for (registration of registrations(); track registration.id) {
      <p>{{ registration.registrationOptionTitle }}</p>
      <button type="button">Transfer registration</button>
    }
  `,
})
class EventActiveRegistrationStubComponent {
  readonly eventId = input.required<string>();
  readonly registrations =
    input.required<
      readonly { id: string; registrationOptionTitle: string }[]
    >();
}

describe('EventDetailsComponent load recovery', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    findEvent.mockReset();
    findRegistrationStatus.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, retry: false },
      },
    });

    TestBed.overrideComponent(EventDetailsComponent, {
      add: { imports: [EventActiveRegistrationStubComponent] },
      remove: { imports: [EventActiveRegistrationComponent] },
    });

    await TestBed.configureTestingModule({
      imports: [EventDetailsComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: ConfigService,
          useValue: {
            tenant: { discountProviders: null },
            updateDescription: vi.fn(),
            updateTitle: vi.fn(),
          },
        },
        {
          provide: EventDetailsOperations,
          useValue: {
            canOrganize: () => ({
              queryFn: async () => false,
              queryKey: ['event-can-organize', 'event-1'],
            }),
            eventListFilter: () => ({ queryKey: ['events'] }),
            eventQueryKey: (id: string) => ['event', id],
            findEvent: (id: string) => ({
              queryFn: findEvent,
              queryKey: ['event', id],
            }),
            myCards: () => ({
              queryFn: async () => [],
              queryKey: ['my-cards'],
            }),
            pendingReviewsFilter: () => ({
              queryKey: ['pending-event-reviews'],
            }),
            registrationStatus: (eventId: string) => ({
              queryFn: findRegistrationStatus,
              queryKey: ['registration-status', eventId],
            }),
            reviewEvent: () => ({
              mutationFn: async () => true,
              mutationKey: ['review-event'],
            }),
            self: () => ({
              queryFn: async () => null,
              queryKey: ['maybe-self'],
            }),
            submitForReview: () => ({
              mutationFn: async () => true,
              mutationKey: ['submit-event-for-review'],
            }),
            updateListing: () => ({
              mutationFn: async () => true,
              mutationKey: ['update-event-listing'],
            }),
          },
        },
        {
          provide: MatDialog,
          useValue: { open: vi.fn() },
        },
        {
          provide: NotificationService,
          useValue: {
            showError: vi.fn(),
            showEventReviewed: vi.fn(),
            showEventSubmitted: vi.fn(),
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            hasPermission: () => signal(false).asReadonly(),
            hasPermissionSync: () => false,
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

  const render = () => {
    const fixture = TestBed.createComponent(EventDetailsComponent);
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.detectChanges();
    return fixture;
  };

  it('retries a failed event load and recovers the event details', async () => {
    findEvent
      .mockRejectedValueOnce(new Error('Event unavailable'))
      .mockResolvedValue(eventDetails);
    findRegistrationStatus.mockResolvedValue({
      isRegistered: false,
      outgoingTransfers: [],
      registrations: [],
    });

    const fixture = render();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Event could not be loaded');
    });
    const alert: HTMLElement | null =
      fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      'The event details are temporarily unavailable.',
    );

    const retryButton: HTMLButtonElement | null =
      alert?.querySelector('button') ?? null;
    expect(retryButton?.textContent?.trim()).toBe('Try again');
    retryButton?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizeText(fixture);
      expect(text).toContain('Recovery workshop');
      expect(text).toContain('Bring a notebook.');
    });
    expect(findEvent).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps event details visible while registration actions recover independently', async () => {
    findEvent.mockResolvedValue(eventDetails);
    findRegistrationStatus
      .mockRejectedValueOnce(new Error('Registration status unavailable'))
      .mockResolvedValue({
        isRegistered: false,
        outgoingTransfers: [],
        registrations: [],
      });

    const fixture = render();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizeText(fixture);
      expect(text).toContain('Recovery workshop');
      expect(text).toContain('Bring a notebook.');
      expect(text).toContain(
        'Registration actions are temporarily unavailable',
      );
    });
    const alert: HTMLElement | null =
      fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      'You can still review the event details.',
    );

    const retryButton: HTMLButtonElement | null =
      alert?.querySelector('button') ?? null;
    expect(retryButton?.textContent?.trim()).toBe('Try again');
    retryButton?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizeText(fixture);
      expect(text).toContain('No registration options');
      expect(text).not.toContain(
        'Registration actions are temporarily unavailable',
      );
    });
    expect(findEvent).toHaveBeenCalledOnce();
    expect(findRegistrationStatus).toHaveBeenCalledTimes(2);
    expect(normalizeText(fixture)).toContain('Recovery workshop');
  });

  it.each([
    {
      expectedCopy: 'Contact an organizer for an update.',
      expectedSummary:
        'one or more refunds due to you may not have reached you',
      refundStatus: 'needsAttention' as const,
      role: 'alert',
      title: 'Transfer refund needs attention',
    },
    {
      expectedCopy: 'No action is needed.',
      expectedSummary: 'all refunds due to you completed',
      refundStatus: 'completed' as const,
      role: 'status',
      title: 'Transfer refund completed',
    },
  ])(
    'shows the previous owner a $refundStatus paid-transfer summary without ticket actions',
    async ({ expectedCopy, expectedSummary, refundStatus, role, title }) => {
      findEvent.mockResolvedValue(eventDetails);
      findRegistrationStatus.mockResolvedValue({
        isRegistered: false,
        outgoingTransfers: [
          {
            currency: 'EUR',
            refundAmount: 1200,
            refundStatus,
            registrationOptionTitle: 'Participant ticket',
            transferId: 'transfer-1',
            transferredAt: '2026-09-18T08:00:00.000Z',
          },
        ],
        registrations: [],
      });

      const fixture = render();

      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(normalizeText(fixture)).toContain(title);
      });
      const summary: HTMLElement | null = fixture.nativeElement.querySelector(
        '[data-testid="outgoing-registration-transfer"]',
      );
      expect(summary).not.toBeNull();
      expect(summary?.getAttribute('role')).toBe(role);
      expect(summary?.textContent).toContain('Participant ticket');
      expect(summary?.textContent).toContain('Total refund for this transfer');
      expect(summary?.textContent).toContain(expectedSummary);
      expect(summary?.textContent).toContain(expectedCopy);
      const transferredTime = summary?.querySelector('time');
      expect(transferredTime?.getAttribute('datetime')).toBe(
        '2026-09-18T08:00:00.000Z',
      );
      expect(transferredTime?.textContent).toContain('Transferred');
      expect(summary?.querySelector('button')).toBeNull();
      expect(
        fixture.nativeElement.querySelector('app-event-active-registration'),
      ).toBeNull();
    },
  );

  it('shows historical outgoing transfer details beside a ticket transferred back to the source', async () => {
    findEvent.mockResolvedValue(eventDetails);
    findRegistrationStatus.mockResolvedValue({
      isRegistered: true,
      outgoingTransfers: [
        {
          currency: 'EUR',
          refundAmount: 0,
          refundStatus: 'notRequired',
          registrationOptionTitle: 'Original participant ticket',
          transferId: 'transfer-away',
          transferredAt: '2026-09-18T08:00:00.000Z',
        },
      ],
      registrations: [
        {
          activeTransfer: null,
          addonPurchases: [],
          cancellationAvailable: true,
          cancellationBlockedReason: 'none',
          guestCount: 0,
          id: 'registration-1',
          organizingRegistration: false,
          paymentPending: false,
          registrationAddOns: [],
          registrationOptionId: 'option-1',
          registrationOptionTitle: 'Returned participant ticket',
          status: 'CONFIRMED',
          transferAvailable: true,
          transferBlockedReason: 'none',
        },
      ],
    });

    const fixture = render();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Original participant ticket');
      expect(normalizeText(fixture)).toContain('Returned participant ticket');
    });
    const history: HTMLElement | null = fixture.nativeElement.querySelector(
      '[data-testid="outgoing-registration-transfer"]',
    );
    const activeRegistration: HTMLElement | null =
      fixture.nativeElement.querySelector('app-event-active-registration');
    const pageText = normalizeText(fixture);

    expect(history?.textContent).toContain(
      'This transfer moved the ticket to its recipient',
    );
    expect(activeRegistration).not.toBeNull();
    expect(activeRegistration?.textContent).toContain(
      'Returned participant ticket',
    );
    expect(activeRegistration?.textContent).toContain('Transfer registration');
    expect(pageText).toContain('These are transfers you previously sent');
    expect(pageText).toContain(
      'its current ticket and actions appear separately below',
    );
    expect(pageText).not.toContain('These tickets now belong');
    expect(pageText).not.toContain('you can no longer manage');
  });
});

describe('EventDetails template', () => {
  it('uses the accepted return-to-draft review language', () => {
    const template = readSource(
      'src/app/events/event-details/event-details.component.html',
    );

    expect(template).toContain('Return to draft');
    expect(template).not.toContain('REJECTED');
  });

  it('labels organizer/helper and participant registration choices as distinct groups', () => {
    const template = readSource(
      'src/app/events/event-details/event-details.component.html',
    );

    expect(template).toContain('aria-label="Organizer/helper opportunities"');
    expect(template).toContain('Organizer/helper opportunities');
    expect(template).toContain('aria-label="Participant registration options"');
    expect(template).toContain('Participant registration options');
  });
});
