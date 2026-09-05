import '@angular/compiler';
import type { RoleLookupRecord } from '@shared/rpc-contracts/app-rpcs/roles.rpcs';

import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import { Component, computed, input, LOCALE_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatAutocompleteHarness } from '@angular/material/autocomplete/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { createRpcQueryFilter } from '@heddendorp/effect-angular-query';
import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { ClientTenantConfig } from '@shared/rpc-contracts/app-rpcs/config.rpcs';
import {
  EventConflictError,
  EventNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import {
  onlineManager,
  provideTanStackQuery,
  QueryClient,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { firstValueFrom, of, timeout } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppRpc } from '../../core/effect-rpc-angular-client';

import { ConfigService } from '../../core/config.service';
import { NotificationService } from '../../core/notification.service';
import { PermissionsService } from '../../core/permissions.service';
import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import { RoleSelectQueries } from '../../shared/components/controls/role-select/role-select.component';
import { EventActiveRegistrationComponent } from '../event-active-registration/event-active-registration.component';
import { EventReviewDialogComponent } from '../event-review-dialog/event-review-dialog.component';
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
        hasRegistrationOptions: true,
        registrationOptions: [{}],
        registrationOptionsHiddenByEligibility: false,
      }),
    ).toBe('visible');
  });

  it('shows an explicit ineligible state when every option is hidden by role eligibility', () => {
    expect(
      registrationOptionsState({
        hasRegistrationOptions: true,
        registrationOptions: [],
        registrationOptionsHiddenByEligibility: true,
      }),
    ).toBe('hiddenByEligibility');
  });

  it('explains the direct-link outcome when organization access does not include a sign-up choice', () => {
    const template = readSource(
      'src/app/events/event-details/event-details.component.html',
    );

    expect(template).toContain('Your access in this organization');
    expect(template).toContain("this event's sign-up choices");
    expect(template).toContain('event, but you cannot sign up.');
  });

  it('keeps optionless events distinct from role-ineligible events', () => {
    expect(
      registrationOptionsState({
        hasRegistrationOptions: false,
        registrationOptions: [],
        registrationOptionsHiddenByEligibility: false,
      }),
    ).toBe('none');
  });

  it('requires sign-in when a guest opens an event with role-restricted options', () => {
    expect(
      registrationOptionsState({
        hasRegistrationOptions: true,
        registrationOptions: [],
        registrationOptionsHiddenByEligibility: false,
      }),
    ).toBe('requiresSignIn');
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
    ).toBe('During sign-up, Before event, During event');
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
    ).toBe('Sign-up choice is missing from this event');
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
type Authentication = Awaited<
  ReturnType<
    ReturnType<typeof AppRpc.injectClient>['config']['isAuthenticated']['call']
  >
>;
const findAuthentication = vi.fn<() => Promise<Authentication>>();
const findMyCards = vi.fn();
const findRegistrationStatus = vi.fn();
const announcementPermission = signal(false);
const openDialog = vi.fn();
const showError = vi.fn();
const showSuccess = vi.fn();
const updateAnnouncementDiscovery = vi.fn(
  async (_input: { announcementRoleIds: string[]; eventId: string }) => true,
);
const tenantConfig: {
  discountProviders: ClientTenantConfig['discountProviders'] | null;
} = {
  discountProviders: {
    esnCard: {
      config: {},
      status: 'enabled',
    },
  },
};

const eventDetails = {
  addOns: [],
  announcementRoleIds: null,
  creatorId: 'user-2',
  description: '<p>Bring a notebook.</p>',
  end: '2030-01-02T12:00:00.000Z',
  hasRegistrationOptions: false,
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
  userIsCreator: false,
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
  const reviewEvent =
    vi.fn<
      NonNullable<
        ReturnType<EventDetailsOperations['reviewEvent']>['mutationFn']
      >
    >();

  beforeEach(async () => {
    findEvent.mockReset();
    findAuthentication.mockReset().mockResolvedValue(true);
    findMyCards.mockReset().mockResolvedValue([]);
    findRegistrationStatus.mockReset();
    reviewEvent.mockReset().mockResolvedValue(undefined);
    tenantConfig.discountProviders = {
      esnCard: { config: {}, status: 'enabled' },
    };
    announcementPermission.set(false);
    openDialog.mockReset();
    showError.mockReset();
    showSuccess.mockReset();
    updateAnnouncementDiscovery.mockReset().mockResolvedValue(true);
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
          provide: TENANT_DATE_PIPE_TIMEZONE,
          useValue: 'Europe/Berlin',
        },
        {
          provide: ConfigService,
          useValue: {
            tenant: tenantConfig,
            updateDescription: vi.fn(),
            updateTitle: vi.fn(),
          },
        },
        {
          provide: EventDetailsOperations,
          useValue: {
            authentication: () => ({
              queryFn: findAuthentication,
              queryKey: ['event-authentication'],
            }),
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
              queryFn: findMyCards,
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
              mutationFn: reviewEvent,
              mutationKey: ['review-event'],
            }),
            submitForReview: () => ({
              mutationFn: async () => true,
              mutationKey: ['submit-event-for-review'],
            }),
            updateAnnouncementDiscovery: () => ({
              mutationFn: updateAnnouncementDiscovery,
              mutationKey: ['update-announcement-visibility'],
            }),
          },
        },
        {
          provide: MatDialog,
          useValue: { open: openDialog },
        },
        {
          provide: NotificationService,
          useValue: {
            showError,
            showEventReviewed: vi.fn(),
            showEventSubmitted: vi.fn(),
            showSuccess,
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            hasPermission: () => announcementPermission.asReadonly(),
            hasPermissionSync: () => announcementPermission(),
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

  it.each([false, true])(
    'shows the event schedule in the tenant timezone and physical location with signed-in state %s',
    async (signedIn) => {
      registerLocaleData(localeDe);
      TestBed.overrideProvider(LOCALE_ID, { useValue: 'de-DE' });
      findAuthentication.mockResolvedValue(signedIn);
      findEvent.mockResolvedValue({
        ...eventDetails,
        end: '2030-01-03T02:00:00.000Z',
        location: {
          address: 'Theaterplatz 2, 78467 Konstanz',
          coordinates: { lat: 47.664, lng: 9.176 },
          name: 'Theatre entrance',
          placeId: 'theatre-entrance',
          type: 'google',
        },
        start: '2030-01-02T23:30:00.000Z',
      });
      findRegistrationStatus.mockResolvedValue({
        isRegistered: false,
        outgoingTransfers: [],
        registrations: [],
      });

      const fixture = render();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(queryClient.getQueryData(['event-authentication'])).toEqual(
          signedIn,
        );
        expect(normalizeText(fixture)).toContain(
          'Starts 03.01.2030 · 00:30 Ends 03.01.2030 · 03:00',
        );
      });
      expect(
        normalizeText(fixture).match(/Times shown in Europe\/Berlin\./gu),
      ).toHaveLength(1);
      const root: HTMLElement = fixture.nativeElement;
      expect(
        [
          ...root.querySelectorAll(
            ':scope section[aria-label="Event details"] dd p',
          ),
        ].map((paragraph) => paragraph.textContent?.trim()),
      ).toEqual(['Theatre entrance', 'Theaterplatz 2, 78467 Konstanz']);
      expect(
        [...root.querySelectorAll('time')].map((time) =>
          time.getAttribute('datetime'),
        ),
      ).toEqual(['2030-01-02T23:30:00.000Z', '2030-01-03T02:00:00.000Z']);
      expect(normalizeText(fixture)).toContain('Bring a notebook.');
    },
  );

  it('identifies an online location without inventing a physical address', async () => {
    findAuthentication.mockResolvedValue(false);
    findEvent.mockResolvedValue({
      ...eventDetails,
      location: {
        meetingProvider: 'other',
        meetingUrl: 'https://meeting.example.test/workshop',
        name: 'Online workshop',
        type: 'online',
      },
    });
    findRegistrationStatus.mockResolvedValue({
      isRegistered: false,
      outgoingTransfers: [],
      registrations: [],
    });

    const fixture = render();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Online workshop');
      expect(normalizeText(fixture)).toContain('Times shown in Europe/Berlin.');
    });
    const root: HTMLElement = fixture.nativeElement;
    expect(
      [
        ...root.querySelectorAll(
          ':scope section[aria-label="Event details"] dd p',
        ),
      ].map((paragraph) => paragraph.textContent?.trim()),
    ).toEqual(['Online workshop', 'Online']);
    expect(normalizeText(fixture)).not.toContain('Not specified');
  });

  it('keeps announcement targeting out of the public event view', async () => {
    findEvent.mockResolvedValue(eventDetails);
    findRegistrationStatus.mockResolvedValue({
      isRegistered: false,
      outgoingTransfers: [],
      registrations: [],
    });

    const fixture = render();
    await vi.waitFor(async () => {
      await fixture.whenStable();
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Recovery workshop');
    });

    expect(normalizeText(fixture)).not.toContain(
      'Who can find this announcement',
    );
    const root: HTMLElement = fixture.nativeElement;
    expect(
      root.querySelector(
        '[aria-label="Choose who can find this announcement"]',
      ),
    ).toBeNull();
  });

  it('does not load discount cards for a signed-out visitor', async () => {
    findAuthentication.mockResolvedValue(false);
    findEvent.mockResolvedValue(eventDetails);
    findRegistrationStatus.mockResolvedValue({
      isRegistered: false,
      outgoingTransfers: [],
      registrations: [],
    });

    const fixture = render();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Recovery workshop');
      expect(findAuthentication).toHaveBeenCalledOnce();
    });
    expect(findMyCards).not.toHaveBeenCalled();
    expect(normalizeText(fixture)).not.toContain(
      'Your discount card could not be checked',
    );
  });

  it('does not load authentication or discount cards when the provider is disabled', async () => {
    tenantConfig.discountProviders = {
      esnCard: { config: {}, status: 'disabled' },
    };
    findEvent.mockResolvedValue(eventDetails);
    findRegistrationStatus.mockResolvedValue({
      isRegistered: false,
      outgoingTransfers: [],
      registrations: [],
    });

    const fixture = render();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Recovery workshop');
    });
    expect(findAuthentication).not.toHaveBeenCalled();
    expect(findMyCards).not.toHaveBeenCalled();
  });

  it('shows and retries a failed discount card check', async () => {
    findEvent.mockResolvedValue(eventDetails);
    findRegistrationStatus.mockResolvedValue({
      isRegistered: false,
      outgoingTransfers: [],
      registrations: [],
    });
    findMyCards
      .mockRejectedValueOnce(new Error('Provider unavailable'))
      .mockResolvedValue([]);

    const fixture = render();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(
        'Your discount card could not be checked',
      );
    });
    const root: HTMLElement = fixture.nativeElement;
    const alert = [
      ...root.querySelectorAll<HTMLElement>('[role="alert"]'),
    ].find((element) => element.textContent?.includes('Your discount card'));
    expect(alert?.textContent).not.toContain('Provider unavailable');
    alert?.querySelector<HTMLButtonElement>('button')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findMyCards).toHaveBeenCalledTimes(2);
      expect(normalizeText(fixture)).not.toContain(
        'Your discount card could not be checked',
      );
    });
  });

  it('shows and retries a failed sign-in check before loading discount cards', async () => {
    findEvent.mockResolvedValue(eventDetails);
    findRegistrationStatus.mockResolvedValue({
      isRegistered: false,
      outgoingTransfers: [],
      registrations: [],
    });
    findAuthentication
      .mockRejectedValueOnce(new Error('Session lookup unavailable'))
      .mockResolvedValue(true);

    const fixture = render();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(
        'Discount card guidance could not be checked',
      );
    });
    expect(findMyCards).not.toHaveBeenCalled();
    const root: HTMLElement = fixture.nativeElement;
    const alert = [
      ...root.querySelectorAll<HTMLElement>('[role="alert"]'),
    ].find((element) =>
      element.textContent?.includes('Discount card guidance'),
    );
    expect(alert?.textContent).not.toContain('Session lookup unavailable');
    alert?.querySelector<HTMLButtonElement>('button')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findAuthentication).toHaveBeenCalledTimes(2);
      expect(findMyCards).toHaveBeenCalledOnce();
      expect(normalizeText(fixture)).not.toContain(
        'Discount card guidance could not be checked',
      );
    });
  });

  it('saves selected announcement roles once while the action is pending', async () => {
    announcementPermission.set(true);
    findEvent.mockResolvedValue({
      ...eventDetails,
      announcementRoleIds: [],
    });
    findRegistrationStatus.mockResolvedValue({
      isRegistered: false,
      outgoingTransfers: [],
      registrations: [],
    });
    openDialog.mockReturnValue({
      afterClosed: () => of({ announcementRoleIds: ['role-organizer'] }),
    });
    let resolveSave: ((value: true) => void) | undefined;
    updateAnnouncementDiscovery.mockImplementation(() => {
      // Angular's browser target does not expose Promise.withResolvers.
      // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
      return new Promise<true>((resolve) => {
        resolveSave = resolve;
      });
    });

    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;
    const failures: unknown[] = [];
    let settledOperation: Promise<void> | undefined;
    const originalAction = fixture.componentInstance[
      'updateAnnouncementDiscovery'
    ].bind(fixture.componentInstance);
    fixture.componentInstance['updateAnnouncementDiscovery'] = vi.fn<
      EventDetailsComponent['updateAnnouncementDiscovery']
    >(() => {
      const operation = originalAction();
      settledOperation = operation.catch((error: unknown) => {
        failures.push(error);
      });
      return operation;
    });
    try {
      await vi.waitFor(async () => {
        await fixture.whenStable();
        fixture.detectChanges();
        expect(root.getAttribute('aria-busy')).toBeNull();
        expect(normalizeText(fixture)).toContain(
          'Who can find this announcement',
        );
      });
      const button = root.querySelector<HTMLButtonElement>(
        '[aria-label="Choose who can find this announcement"]',
      );
      if (!button) throw new Error('Expected announcement targeting action');

      button.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(updateAnnouncementDiscovery).toHaveBeenCalledOnce();
        expect(button.disabled).toBe(true);
      });
      button.click();
      expect(updateAnnouncementDiscovery).toHaveBeenCalledOnce();
      expect(updateAnnouncementDiscovery.mock.calls[0]?.[0]).toEqual({
        announcementRoleIds: ['role-organizer'],
        eventId: 'event-1',
      });

      resolveSave?.(true);
      await vi.waitFor(() => {
        expect(showSuccess).toHaveBeenCalledWith(
          'Who can find the announcement was updated',
        );
      });
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        resolveSave?.(true);
      } catch (error) {
        failures.push(error);
      }
      try {
        await settledOperation;
      } catch (error) {
        failures.push(error);
      }
      try {
        await fixture.whenStable();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Announcement action scenario or cleanup failed.',
        { cause: failures[0] },
      );
    }
  });

  it('explains when announcement visibility could not be loaded', async () => {
    announcementPermission.set(true);
    findEvent.mockResolvedValue(eventDetails);
    findRegistrationStatus.mockResolvedValue({
      isRegistered: false,
      outgoingTransfers: [],
      registrations: [],
    });

    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;
    await vi.waitFor(async () => {
      await fixture.whenStable();
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Recovery workshop');
    });

    const button = root.querySelector<HTMLButtonElement>(
      '[aria-label="Choose who can find this announcement"]',
    );
    if (!button) throw new Error('Expected announcement targeting action');
    button.click();

    expect(showError).toHaveBeenCalledWith(
      'Who can find this announcement could not be loaded. No change can be made right now.',
    );
  });

  it('explains a stored registration-settings conflict without offering a registration form', async () => {
    findEvent.mockRejectedValue(
      new EventConflictError({
        message: 'internal question count must not leak',
      }),
    );
    findRegistrationStatus.mockResolvedValue({
      isRegistered: false,
      outgoingTransfers: [],
      registrations: [],
    });
    const fixture = render();
    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizeText(fixture);
      expect(text).toContain('Registration unavailable');
      expect(text).toContain('Contact the organizer');
      expect(text).not.toContain('Check your connection');
      expect(text).not.toContain('internal question count');
    });
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(root.querySelector('app-event-registration-option')).toBeNull();
    expect(findEvent).toHaveBeenCalledTimes(1);
  });

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
    expect(normalizeText(fixture)).toContain('Not specified');
  });

  it('refreshes deleted event details and invalidates list and review caches after approval fails', async () => {
    TestBed.overrideProvider(PermissionsService, {
      useValue: {
        hasPermission: () => signal(true).asReadonly(),
        hasPermissionSync: () => true,
      },
    });
    const deletedEvent = new EventNotFoundError({
      id: 'event-1',
      message: 'Event not found',
    });
    findEvent
      .mockResolvedValueOnce({ ...eventDetails, status: 'PENDING_REVIEW' })
      .mockRejectedValue(deletedEvent);
    reviewEvent.mockRejectedValue(deletedEvent);
    findRegistrationStatus.mockResolvedValue({
      isRegistered: false,
      outgoingTransfers: [],
      registrations: [],
    });
    queryClient.setQueryDefaults(['events'], { gcTime: Infinity });
    queryClient.setQueryDefaults(['pending-event-reviews'], {
      gcTime: Infinity,
    });
    queryClient.setQueryData(['events'], [eventDetails]);
    queryClient.setQueryData(['pending-event-reviews'], [eventDetails]);
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;
    await vi.waitFor(() => {
      fixture.detectChanges();
      const approve = [...root.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Approve',
      );
      expect(approve?.disabled).toBe(false);
    });
    const approve = [...root.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Approve',
    );
    if (!approve) throw new Error('Expected an event approval button');
    approve.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findEvent).toHaveBeenCalledTimes(2);
      expect(queryClient.getQueryState(['events'])?.isInvalidated).toBe(true);
      expect(
        queryClient.getQueryState(['pending-event-reviews'])?.isInvalidated,
      ).toBe(true);
      expect(normalizeText(fixture)).toContain('Event unavailable');
      expect(normalizeText(fixture)).toContain('Event could not be loaded');
      expect(normalizeText(fixture)).not.toContain('Recovery workshop');
      expect(
        [...root.querySelectorAll('button')].some(
          (button) => button.textContent?.trim() === 'Approve',
        ),
      ).toBe(false);
    });
    expect(reviewEvent).toHaveBeenCalledTimes(1);
    expect(reviewEvent.mock.calls[0]?.[0]).toEqual({
      approved: true,
      eventId: 'event-1',
    });
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
      expect(text).toContain('Sign-up details could not be loaded');
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
      expect(text).toContain('Information only');
      expect(text).not.toContain('Sign-up details could not be loaded');
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
    expect(template).toContain('aria-label="Sign-up choices for attendees"');
    expect(template).toContain('Sign-up choices for attendees');
  });
});

describe('EventDetailsComponent review action outcomes', () => {
  type OutcomeRpc = ReturnType<typeof AppRpc.injectClient>;
  type EventRecord = Awaited<
    ReturnType<OutcomeRpc['events']['findOne']['call']>
  >;
  type ReviewMutation = NonNullable<
    ReturnType<EventDetailsOperations['reviewEvent']>['mutationFn']
  >;
  type SubmitMutation = NonNullable<
    ReturnType<EventDetailsOperations['submitForReview']>['mutationFn']
  >;
  type DiscoveryMutation = NonNullable<
    ReturnType<
      EventDetailsOperations['updateAnnouncementDiscovery']
    >['mutationFn']
  >;
  type Action = 'approve' | 'discovery' | 'returnToDraft' | 'submit';
  type ReviewList = Awaited<
    ReturnType<OutcomeRpc['events']['getPendingReviews']['call']>
  >;
  type EventList = Awaited<
    ReturnType<OutcomeRpc['events']['eventList']['call']>
  >;
  const review = vi.fn<ReviewMutation>();
  const submitReview = vi.fn<SubmitMutation>();
  const changeDiscovery = vi.fn<DiscoveryMutation>();
  const loadEvent = vi.fn<(id: string) => Promise<EventRecord>>();
  const reviewedNotice = vi.fn<NotificationService['showEventReviewed']>();
  const submittedNotice = vi.fn<NotificationService['showEventSubmitted']>();
  const successNotice = vi.fn<NotificationService['showSuccess']>();
  const errorNotice = vi.fn<NotificationService['showError']>();
  const comment = 'Retained feedback: confirm the accessible entrance.';
  const roles: readonly RoleLookupRecord[] = [
    {
      defaultOrganizerRole: false,
      defaultUserRole: true,
      id: 'role-attendee',
      name: 'Attendee',
    },
    {
      defaultOrganizerRole: true,
      defaultUserRole: false,
      id: 'role-organizer',
      name: 'Organizer',
    },
  ];
  const selectedRoleIds = ['role-attendee', 'role-organizer'];
  const tenant = new ClientTenantConfig({
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
  const record = (status: EventRecord['status']): EventRecord => ({
    addOns: [],
    announcementRoleCount: 1,
    announcementRoleIds: ['role-attendee'],
    creatorId: 'user-1',
    description: '<p>Retained event description.</p>',
    end: '2030-01-02T12:00:00.000Z',
    hasRegistrationOptions: false,
    icon: { iconColor: 2, iconName: 'calendar:fas' },
    id: 'event-1',
    location: null,
    registrationOptions: [],
    registrationOptionsHiddenByEligibility: false,
    reviewer: null,
    start: '2030-01-02T10:00:00.000Z',
    status,
    statusComment: null,
    title: 'Outcome workshop',
    userIsCreator: true,
  });
  const unknownReview =
    'The outcome could not be confirmed. Load this event again to check its status before making another change.';
  const unknownDiscovery =
    'The outcome could not be confirmed. Load this event again to check who can find the announcement before making another change.';
  const confirmedReadFailure = (action: Action) => {
    switch (action) {
      case 'approve': {
        return 'The event was approved, but some event information could not be refreshed. Load this event again before making another change.';
      }
      case 'discovery': {
        return 'Who can find the announcement was updated, but the latest event details could not be loaded. Load this event again before making another change.';
      }
      case 'returnToDraft': {
        return 'The event was returned to draft, but some event information could not be refreshed. Load this event again before making another change.';
      }
      case 'submit': {
        return 'The event was submitted for review, but some event information could not be refreshed. Load this event again before making another change.';
      }
    }
  };
  const mutationFor = (action: Action) =>
    action === 'discovery'
      ? changeDiscovery
      : action === 'submit'
        ? submitReview
        : review;
  const expectedPayload = (action: Action) => {
    switch (action) {
      case 'approve': {
        return { approved: true, eventId: 'event-1' };
      }
      case 'discovery': {
        return { announcementRoleIds: selectedRoleIds, eventId: 'event-1' };
      }
      case 'returnToDraft': {
        return { approved: false, comment, eventId: 'event-1' };
      }
      case 'submit': {
        return { eventId: 'event-1' };
      }
    }
  };
  let queryClient: QueryClient;
  let cleanupQueryClient: QueryClient | undefined;
  let cleanupDialog: MatDialog | undefined;
  let fixture: ComponentFixture<EventDetailsComponent> | undefined;
  const rootElement = () => {
    const element: unknown = fixture?.nativeElement;
    if (!(element instanceof HTMLElement))
      throw new Error('Expected the event-details root.');
    return element;
  };
  const detectChanges = () => {
    if (!fixture) throw new Error('Expected an event-details fixture.');
    fixture.detectChanges();
  };
  const buttonNamed = (root: ParentNode, text: string) => {
    const button = [
      ...root.querySelectorAll<HTMLButtonElement>(':scope button'),
    ].find(
      (candidate) =>
        candidate.textContent?.replaceAll(/\s+/g, ' ').trim() === text,
    );
    if (!button) throw new Error('Expected the ' + text + ' button.');
    return button;
  };
  const dialogElement = () => {
    const dialog = document.querySelector<HTMLElement>('mat-dialog-container');
    if (!dialog) throw new Error('Expected the actual Material dialog.');
    return dialog;
  };
  const discoveryButton = () => {
    const button = rootElement().querySelector<HTMLButtonElement>(
      ':scope [aria-label="Choose who can find this announcement"]',
    );
    if (!button) throw new Error('Expected the discovery action.');
    return button;
  };
  const pageButton = (action: Action) =>
    action === 'discovery'
      ? discoveryButton()
      : buttonNamed(
          rootElement(),
          action === 'approve'
            ? 'Approve'
            : action === 'returnToDraft'
              ? 'Return to draft'
              : 'Submit for Review',
        );
  const expectNoSuccess = () => {
    expect(reviewedNotice).not.toHaveBeenCalled();
    expect(submittedNotice).not.toHaveBeenCalled();
    expect(successNotice).not.toHaveBeenCalled();
  };
  const expectSingleMutation = (action: Action) => {
    expect(mutationFor(action)).toHaveBeenCalledExactlyOnceWith(
      expectedPayload(action),
      expect.objectContaining({ client: queryClient }),
    );
    expect(
      review.mock.calls.length +
        submitReview.mock.calls.length +
        changeDiscovery.mock.calls.length,
    ).toBe(1);
  };
  const expectFeedback = async (message: string) => {
    await vi.waitFor(() => {
      detectChanges();
      expect(
        rootElement().querySelector(
          ':scope [data-testid="event-review-action-message"]',
        )?.textContent,
      ).toContain(message);
      expect(errorNotice).toHaveBeenCalledWith(message);
    });
  };
  const eventKey = (
    id: string,
  ): ReturnType<EventDetailsOperations['eventQueryKey']> => [
    ['events', 'findOne'],
    { input: { id }, type: 'query' },
  ];

  beforeEach(async () => {
    cleanupDialog = undefined;
    cleanupQueryClient = undefined;
    fixture = undefined;
    review.mockReset().mockResolvedValue(undefined);
    submitReview.mockReset().mockResolvedValue(undefined);
    changeDiscovery.mockReset().mockResolvedValue(undefined);
    loadEvent.mockReset();
    reviewedNotice.mockReset();
    submittedNotice.mockReset();
    successNotice.mockReset();
    errorNotice.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { gcTime: 0, retry: false },
        queries: { gcTime: 0, retry: false, staleTime: Infinity },
      },
    });
    cleanupQueryClient = queryClient;
    const operations = {
      authentication: () => ({
        queryFn: async () => false,
        queryKey: [['config', 'isAuthenticated'], { type: 'query' }],
      }),
      canOrganize: (eventId: string) => ({
        queryFn: async () => false,
        queryKey: [
          ['events', 'canOrganize'],
          { input: { eventId }, type: 'query' },
        ],
      }),
      eventListFilter: () => createRpcQueryFilter(['events', 'eventList']),
      eventQueryKey: eventKey,
      findEvent: (id: string) => ({
        queryFn: () => loadEvent(id),
        queryKey: eventKey(id),
      }),
      myCards: () => ({
        queryFn: async () => [],
        queryKey: [['discounts', 'getMyCards'], { type: 'query' }],
      }),
      pendingReviewsFilter: () =>
        createRpcQueryFilter(['events', 'getPendingReviews']),
      registrationStatus: (eventId: string) => ({
        queryFn: async () => ({
          isRegistered: false,
          outgoingTransfers: [],
          registrations: [],
        }),
        queryKey: [
          ['events', 'getRegistrationStatus'],
          { input: { eventId }, type: 'query' },
        ],
      }),
      reviewEvent: () => ({ mutationFn: review }),
      submitForReview: () => ({ mutationFn: submitReview }),
      updateAnnouncementDiscovery: () => ({ mutationFn: changeDiscovery }),
    } satisfies Pick<EventDetailsOperations, keyof EventDetailsOperations>;
    const allowed = new Set<
      Parameters<PermissionsService['hasPermission']>[number]
    >([
      'events:changeAnnouncementDiscovery',
      'events:editAll',
      'events:review',
    ]);
    await TestBed.configureTestingModule({
      imports: [EventDetailsComponent, MatDialogModule],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: TENANT_DATE_PIPE_TIMEZONE, useValue: 'Europe/Berlin' },
        { provide: EventDetailsOperations, useValue: operations },
        {
          provide: ConfigService,
          useValue: {
            tenant,
            updateDescription: vi.fn<ConfigService['updateDescription']>(),
            updateTitle: vi.fn<ConfigService['updateTitle']>(),
          } satisfies Pick<
            ConfigService,
            'tenant' | 'updateDescription' | 'updateTitle'
          >,
        },
        {
          provide: PermissionsService,
          useValue: {
            hasPermission: (
              ...permissions: Parameters<PermissionsService['hasPermission']>
            ) =>
              computed(() =>
                permissions.every((permission) => allowed.has(permission)),
              ),
            hasPermissionSync: (
              ...permissions: Parameters<
                PermissionsService['hasPermissionSync']
              >
            ) => permissions.every((permission) => allowed.has(permission)),
          } satisfies Pick<
            PermissionsService,
            'hasPermission' | 'hasPermissionSync'
          >,
        },
        {
          provide: NotificationService,
          useValue: {
            showError: errorNotice,
            showEventReviewed: reviewedNotice,
            showEventSubmitted: submittedNotice,
            showSuccess: successNotice,
          } satisfies Pick<
            NotificationService,
            | 'showError'
            | 'showEventReviewed'
            | 'showEventSubmitted'
            | 'showSuccess'
          >,
        },
        {
          provide: RoleSelectQueries,
          useValue: {
            catalog: (): ReturnType<RoleSelectQueries['catalog']> => ({
              queryFn: async () => roles,
              queryKey: [['roles', 'findMany'], { input: {}, type: 'query' }],
            }),
          } satisfies Pick<RoleSelectQueries, 'catalog'>,
        },
      ],
    }).compileComponents();
    cleanupDialog = TestBed.inject(MatDialog);
  });

  afterEach(async () => {
    const failures: unknown[] = [];
    try {
      cleanupDialog?.closeAll();
    } catch (error) {
      failures.push(error);
    }
    try {
      await fixture?.whenStable();
    } catch (error) {
      failures.push(error);
    }
    try {
      TestBed.resetTestingModule();
    } catch (error) {
      failures.push(error);
    }
    try {
      cleanupQueryClient?.clear();
    } catch (error) {
      failures.push(error);
    }
    try {
      vi.restoreAllMocks();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Event details review action cleanup failed',
      );
    }
  });

  const renderAction = async (
    action: Action,
    status: EventRecord['status'] = action === 'submit'
      ? 'DRAFT'
      : action === 'discovery'
        ? 'APPROVED'
        : 'PENDING_REVIEW',
  ) => {
    loadEvent.mockResolvedValue(record(status));
    fixture = TestBed.createComponent(EventDetailsComponent);
    fixture.componentRef.setInput('eventId', 'event-1');
    await vi.waitFor(() => {
      detectChanges();
      expect(pageButton(action).disabled).toBe(false);
      expect(rootElement().getAttribute('aria-busy')).toBeNull();
    });
    return fixture;
  };
  const openAction = async (action: Exclude<Action, 'approve'>) => {
    pageButton(action).click();
    await vi.waitFor(() => {
      detectChanges();
      expect(dialogElement().textContent).toContain(
        action === 'returnToDraft'
          ? 'Return event to draft'
          : action === 'submit'
            ? 'Submit Event for Review'
            : 'Choose who can find Outcome workshop',
      );
    });
    return dialogElement();
  };
  const confirmAction = async (action: Action) => {
    if (action === 'approve') {
      pageButton(action).click();
      return;
    }
    const dialog = await openAction(action);
    await confirmOpenDialog(action, dialog);
  };
  const confirmOpenDialog = async (
    action: Exclude<Action, 'approve'>,
    dialog: HTMLElement,
  ) => {
    if (action === 'returnToDraft') {
      const textarea =
        dialog.querySelector<HTMLTextAreaElement>(':scope textarea');
      if (!textarea) throw new Error('Expected the review-feedback field.');
      textarea.value = comment;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      detectChanges();
      const formElement = dialog.querySelector(':scope form');
      if (!formElement) throw new Error('Expected the review form.');
      expect(buttonNamed(dialog, 'Return to draft').disabled).toBe(false);
      formElement.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    } else if (action === 'submit') {
      buttonNamed(dialog, 'Submit for Review').click();
    } else {
      if (!fixture) throw new Error('Expected the event fixture.');
      const dialogReference = TestBed.inject(MatDialog).getDialogById(
        dialog.id,
      );
      if (!dialogReference)
        throw new Error('Expected the open discovery dialog.');
      await firstValueFrom(
        dialogReference.afterOpened().pipe(timeout({ first: 2000 })),
      );
      await vi.waitFor(() => {
        detectChanges();
        expect(dialog.contains(document.activeElement)).toBe(true);
      });
      const autocomplete = await TestbedHarnessEnvironment.documentRootLoader(
        fixture,
      ).getHarness(
        MatAutocompleteHarness.with({
          ancestor: 'app-update-announcement-discovery-dialog app-role-select',
        }),
      );
      await vi.waitFor(async () => {
        detectChanges();
        expect(await autocomplete.isDisabled()).toBe(false);
        const selectedRoles = [
          ...dialog.querySelectorAll(':scope mat-chip-row'),
        ].map((chip) => chip.textContent?.replaceAll(/\s+/g, ' ').trim());
        expect(selectedRoles).toEqual(['Attendee']);
      });
      await autocomplete.enterText('Organizer');
      await vi.waitFor(async () => {
        detectChanges();
        expect(await autocomplete.isOpen()).toBe(true);
        expect(
          await autocomplete.getOptions({ text: 'Organizer' }),
        ).toHaveLength(1);
      });
      await autocomplete.selectOption({ text: 'Organizer' });
      await vi.waitFor(() => {
        detectChanges();
        expect(buttonNamed(dialog, 'Save').disabled).toBe(false);
        expect(dialog.textContent).toContain('Organizer');
      });
      buttonNamed(dialog, 'Save').click();
    }
  };

  it.each(['approve', 'returnToDraft', 'submit', 'discovery'] as const)(
    'keeps the confirmed %s outcome visible when the real event read fails',
    async (action) => {
      await renderAction(action);
      loadEvent.mockRejectedValueOnce(new Error('Event detail read failed.'));
      await confirmAction(action);
      await expectFeedback(confirmedReadFailure(action));
      expectSingleMutation(action);
      expect(loadEvent).toHaveBeenCalledTimes(2);
      expect(queryClient.getQueryState(eventKey('event-1'))?.status).toBe(
        'error',
      );
      expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
        'success',
      );
      expect(rootElement().textContent).toContain('Event could not be loaded');
      expect(rootElement().textContent).not.toContain(
        'The outcome could not be confirmed.',
      );
      expectNoSuccess();

      buttonNamed(rootElement(), 'Try again').click();
      await vi.waitFor(() => {
        detectChanges();
        expect(loadEvent).toHaveBeenCalledTimes(3);
        expect(rootElement().querySelector(':scope h1')?.textContent).toContain(
          'Outcome workshop',
        );
        expect(queryClient.getQueryState(eventKey('event-1'))).toEqual(
          expect.objectContaining({ fetchStatus: 'idle', status: 'success' }),
        );
      });
      await fixture?.whenStable();
      await expectFeedback(confirmedReadFailure(action));
      expectSingleMutation(action);
      expectNoSuccess();
    },
  );

  it.each(['approve', 'returnToDraft', 'submit', 'discovery'] as const)(
    'keeps a lost %s response uncertain after a test-local simulated commit',
    async (action) => {
      await renderAction(action);
      let simulatedCommit = false;
      mutationFor(action).mockImplementationOnce(async () => {
        simulatedCommit = true;
        throw new Error('Response lost after the simulated commit.');
      });
      await confirmAction(action);
      await expectFeedback(
        action === 'discovery' ? unknownDiscovery : unknownReview,
      );
      expect(simulatedCommit).toBe(true);
      expectSingleMutation(action);
      expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
        'error',
      );
      expectNoSuccess();
      expect(rootElement().textContent).not.toContain(
        confirmedReadFailure(action),
      );
      expect(rootElement().textContent).not.toContain(
        'Response lost after the simulated commit.',
      );

      await vi.waitFor(() => {
        detectChanges();
        expect(rootElement().getAttribute('aria-busy')).toBeNull();
        expect(queryClient.isFetching()).toBe(0);
      });
      loadEvent.mockRejectedValueOnce(new Error('Later event read failed.'));
      await expect(
        queryClient.refetchQueries(
          { exact: true, queryKey: eventKey('event-1') },
          { throwOnError: true },
        ),
      ).rejects.toThrow('Later event read failed.');
      await vi.waitFor(() => {
        detectChanges();
        expect(buttonNamed(rootElement(), 'Try again').disabled).toBe(false);
      });
      buttonNamed(rootElement(), 'Try again').click();
      await vi.waitFor(() => {
        detectChanges();
        expect(rootElement().querySelector(':scope h1')?.textContent).toContain(
          'Outcome workshop',
        );
        expect(queryClient.getQueryState(eventKey('event-1'))).toEqual(
          expect.objectContaining({ fetchStatus: 'idle', status: 'success' }),
        );
      });
      await fixture?.whenStable();
      await expectFeedback(
        action === 'discovery' ? unknownDiscovery : unknownReview,
      );
      expectSingleMutation(action);
      expectNoSuccess();
    },
  );

  it.each(['approve', 'submit', 'discovery'] as const)(
    'keeps all actions locked after %s succeeds until both a failed and a held read under the same list filter settle',
    async (action) => {
      const currentFixture = await renderAction(
        action,
        action === 'submit' || action === 'discovery'
          ? 'DRAFT'
          : 'PENDING_REVIEW',
      );
      if (action === 'submit')
        loadEvent.mockResolvedValueOnce(record('PENDING_REVIEW'));
      const listRead = vi.fn<() => Promise<EventList>>().mockResolvedValue([]);
      const secondListRead = vi
        .fn<() => Promise<EventList>>()
        .mockResolvedValue([]);
      const reviewListRead = vi
        .fn<() => Promise<ReviewList>>()
        .mockResolvedValue([]);
      const listOptions: ReturnType<
        OutcomeRpc['events']['eventList']['queryOptions']
      > = {
        queryFn: listRead,
        queryKey: [
          ['events', 'eventList'],
          {
            input: {
              limit: 100,
              offset: 0,
              startAfter: '2030-01-01T00:00:00.000Z',
              status: [],
            },
            type: 'query',
          },
        ],
      };
      const secondListOptions: ReturnType<
        OutcomeRpc['events']['eventList']['queryOptions']
      > = {
        queryFn: secondListRead,
        queryKey: [
          ['events', 'eventList'],
          {
            input: {
              limit: 100,
              offset: 100,
              startAfter: '2030-01-01T00:00:00.000Z',
              status: [],
            },
            type: 'query',
          },
        ],
      };
      const reviewListOptions: ReturnType<
        OutcomeRpc['events']['getPendingReviews']['queryOptions']
      > = {
        queryFn: reviewListRead,
        queryKey: [['events', 'getPendingReviews'], { type: 'query' }],
      };
      const listObserver = new QueryObserver(queryClient, listOptions);
      const secondListObserver = new QueryObserver(
        queryClient,
        secondListOptions,
      );
      const reviewObserver = new QueryObserver(queryClient, reviewListOptions);
      let listStatus = 'loading';
      let secondListStatus = 'loading';
      let reviewStatus = 'loading';
      let stopList: (() => void) | undefined;
      let stopSecondList: (() => void) | undefined;
      let stopReviews: (() => void) | undefined;
      const failures: unknown[] = [];
      let releaseRead: ((value: EventList) => void) | undefined;
      // Angular's browser target does not expose Promise.withResolvers.
      // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
      const heldRead = new Promise<EventList>((resolve) => {
        releaseRead = resolve;
      });
      try {
        stopList = listObserver.subscribe((result) => {
          listStatus = result.status;
        });
        stopSecondList = secondListObserver.subscribe((result) => {
          secondListStatus = result.status;
        });
        stopReviews = reviewObserver.subscribe((result) => {
          reviewStatus = result.status;
        });
        await vi.waitFor(() => {
          expect(listStatus).toBe('success');
          expect(reviewStatus).toBe('success');
          expect(secondListStatus).toBe('success');
        });
        listRead.mockRejectedValueOnce(
          new Error('The event list could not be read.'),
        );
        secondListRead.mockReturnValueOnce(heldRead);
        await confirmAction(action);
        await vi.waitFor(() => {
          detectChanges();
          expect(listRead).toHaveBeenCalledTimes(2);
          expect(reviewListRead).toHaveBeenCalledTimes(2);
          expect(secondListRead).toHaveBeenCalledTimes(2);
          expect(listStatus).toBe('error');
          expect(queryClient.getQueryState(eventKey('event-1'))?.status).toBe(
            'success',
          );
          expect(
            queryClient.getQueryState(eventKey('event-1'))?.fetchStatus,
          ).toBe('idle');
          expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
            'success',
          );
        });
        expect(rootElement().getAttribute('aria-busy')).toBe('true');
        const buttons = [
          ...rootElement().querySelectorAll<HTMLButtonElement>(':scope button'),
        ].filter(
          (button) =>
            ['Approve', 'Return to draft', 'Submit for Review'].includes(
              button.textContent?.trim() ?? '',
            ) ||
            button.getAttribute('aria-label') ===
              'Choose who can find this announcement',
        );
        expect(buttons.length).toBeGreaterThanOrEqual(2);
        for (const button of buttons) {
          expect(button.disabled).toBe(true);
          button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(0);
        expectSingleMutation(action);
        expectNoSuccess();
        expect(
          rootElement().querySelector(
            ':scope [data-testid="event-review-action-message"]',
          ),
        ).toBeNull();
      } catch (error) {
        failures.push(error);
      } finally {
        try {
          releaseRead?.([]);
        } catch (error) {
          failures.push(error);
        }
        try {
          await heldRead;
        } catch (error) {
          failures.push(error);
        }
        try {
          await currentFixture.whenStable();
        } catch (error) {
          failures.push(error);
        }
        try {
          await vi.waitFor(() => {
            expect(queryClient.isFetching()).toBe(0);
          });
        } catch (error) {
          failures.push(error);
        }
        for (const stop of [stopList, stopSecondList, stopReviews]) {
          try {
            stop?.();
          } catch (error) {
            failures.push(error);
          }
        }
      }
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'Event review read ownership or cleanup failed.',
          { cause: failures[0] },
        );
      await expectFeedback(confirmedReadFailure(action));
      expectSingleMutation(action);
      expectNoSuccess();
      await vi.waitFor(() => {
        detectChanges();
        expect(
          pageButton(action === 'discovery' ? 'discovery' : 'approve').disabled,
        ).toBe(false);
        expect(rootElement().getAttribute('aria-busy')).toBeNull();
      });
    },
  );

  it('restores the submitted review comment on explicit reopen after an uncertain response', async () => {
    await renderAction('returnToDraft');
    review.mockRejectedValueOnce(new Error('Review response lost.'));
    await confirmAction('returnToDraft');
    await expectFeedback(unknownReview);
    await vi.waitFor(() => {
      detectChanges();
      expect(pageButton('returnToDraft').disabled).toBe(false);
    });
    const dialog = await openAction('returnToDraft');
    expect(
      dialog.querySelector<HTMLTextAreaElement>(':scope textarea')?.value,
    ).toBe(comment);
    expectSingleMutation('returnToDraft');
    buttonNamed(dialog, 'Cancel').click();
    await fixture?.whenStable();
    expectSingleMutation('returnToDraft');
    expectNoSuccess();
  });

  it('restores submitted announcement roles on explicit reopen after an uncertain response', async () => {
    await renderAction('discovery');
    changeDiscovery.mockRejectedValueOnce(
      new Error('Discovery response lost.'),
    );
    await confirmAction('discovery');
    await expectFeedback(unknownDiscovery);
    await vi.waitFor(() => {
      detectChanges();
      expect(discoveryButton().disabled).toBe(false);
    });
    const dialog = await openAction('discovery');
    await vi.waitFor(() => {
      detectChanges();
      const chips = [...dialog.querySelectorAll(':scope mat-chip-row')].map(
        (chip) => chip.textContent?.replaceAll(/\s+/g, ' ').trim(),
      );
      expect(chips).toEqual(['Attendee', 'Organizer']);
    });
    expectSingleMutation('discovery');
    buttonNamed(dialog, 'Cancel').click();
    await fixture?.whenStable();
    expectSingleMutation('discovery');
    expectNoSuccess();
  });

  it.each(['returnToDraft', 'submit', 'discovery'] as const)(
    'cancels the %s confirmation without a mutation and releases the action lock',
    async (action) => {
      await renderAction(action);
      const dialog = await openAction(action);
      buttonNamed(dialog, 'Cancel').click();
      await vi.waitFor(() => {
        detectChanges();
        expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(0);
        expect(pageButton(action).disabled).toBe(false);
      });
      expect(review).not.toHaveBeenCalled();
      expect(submitReview).not.toHaveBeenCalled();
      expect(changeDiscovery).not.toHaveBeenCalled();
      expectNoSuccess();
    },
  );

  it.each([
    new EventConflictError({
      message: 'This event is no longer waiting for review.',
    }),
    new EventNotFoundError({
      id: 'event-1',
      message: 'This event could not be found.',
    }),
    new RpcBadRequestError({
      message: 'Add feedback before returning this event to draft.',
    }),
  ])(
    'preserves the expected $_tag review message without a success notification',
    async (error) => {
      await renderAction('approve');
      review.mockRejectedValueOnce(error);
      await confirmAction('approve');
      await vi.waitFor(() => {
        detectChanges();
        expect(
          rootElement().querySelector(
            ':scope [data-testid="event-review-action-message"]',
          )?.textContent,
        ).toContain(error.message);
      });
      expectSingleMutation('approve');
      expectNoSuccess();
      expect(rootElement().textContent).not.toContain(unknownReview);
    },
  );

  it('preserves the conflict message without claiming fresh details when the real query pauses offline', async () => {
    const originalOnlineState = onlineManager.isOnline();
    let stopObserver: (() => void) | undefined;
    const failures: unknown[] = [];
    try {
      onlineManager.setOnline(true);
      await renderAction('approve');
      const cachedEvent = queryClient.getQueryData<EventRecord>(
        eventKey('event-1'),
      );
      expect(cachedEvent).toEqual(record('PENDING_REVIEW'));
      const detailOptions: ReturnType<EventDetailsOperations['findEvent']> = {
        queryFn: () => loadEvent('event-1'),
        queryKey: eventKey('event-1'),
      };
      const detailObserver = new QueryObserver(queryClient, detailOptions);
      let observedFetchStatus = detailObserver.getCurrentResult().fetchStatus;
      let observedData = detailObserver.getCurrentResult().data;
      stopObserver = detailObserver.subscribe((result) => {
        observedFetchStatus = result.fetchStatus;
        observedData = result.data;
      });
      const conflict = new EventConflictError({
        message: 'This event changed before the review was saved.',
      });
      review.mockImplementationOnce(async () => {
        onlineManager.setOnline(false);
        throw conflict;
      });
      await confirmAction('approve');
      await expectFeedback(conflict.message);
      await vi.waitFor(() => {
        detectChanges();
        expect(observedFetchStatus).toBe('paused');
        expect(
          queryClient.getQueryState(eventKey('event-1'))?.fetchStatus,
        ).toBe('paused');
        expect(queryClient.getQueryState(eventKey('event-1'))?.status).toBe(
          'success',
        );
        expect(rootElement().getAttribute('aria-busy')).toBeNull();
      });
      expect(observedData).toEqual(cachedEvent);
      expect(queryClient.getQueryData(eventKey('event-1'))).toEqual(
        cachedEvent,
      );
      expect(loadEvent).toHaveBeenCalledTimes(1);
      expectSingleMutation('approve');
      expectNoSuccess();
      expect(errorNotice).toHaveBeenCalledExactlyOnceWith(conflict.message);
      expect(rootElement().textContent).not.toContain(
        'The latest event details are now shown.',
      );
      expect(rootElement().textContent).not.toContain(
        'Some event information could not be refreshed.',
      );
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        await queryClient.cancelQueries();
      } catch (error) {
        failures.push(error);
      }
      try {
        stopObserver?.();
      } catch (error) {
        failures.push(error);
      }
      // Retire the component observer before restoring connectivity: reconnect
      // must not start a second transport after the paused query was cancelled.
      try {
        fixture?.destroy();
      } catch (error) {
        failures.push(error);
      }
      try {
        queryClient.clear();
      } catch (error) {
        failures.push(error);
      }
      try {
        onlineManager.setOnline(originalOnlineState);
      } catch (error) {
        failures.push(error);
      }
      try {
        await fixture?.whenStable();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Paused event conflict scenario or cleanup failed.',
        { cause: failures[0] },
      );
    }
  });

  it('does not claim that conflict details were loaded when the actual follow-up read fails', async () => {
    const currentFixture = await renderAction('approve');
    review.mockRejectedValueOnce(
      new EventConflictError({
        message: 'This event changed before the review was saved.',
      }),
    );
    loadEvent.mockRejectedValueOnce(new Error('Conflict detail read failed.'));
    await confirmAction('approve');
    await expectFeedback(
      'This event changed before the review was saved. Some event information could not be refreshed. Load this event again before making another change.',
    );
    expectSingleMutation('approve');
    expect(loadEvent).toHaveBeenCalledTimes(2);
    expect(rootElement().textContent).not.toContain(
      'latest event details are now shown',
    );
    expectNoSuccess();

    loadEvent.mockRejectedValueOnce(new Error('Explicit detail retry failed.'));
    buttonNamed(rootElement(), 'Try again').click();
    await vi.waitFor(() => {
      detectChanges();
      expect(loadEvent).toHaveBeenCalledTimes(3);
      expect(buttonNamed(rootElement(), 'Try again').disabled).toBe(false);
    });
    await expectFeedback(
      'This event changed before the review was saved. Some event information could not be refreshed. Load this event again before making another change.',
    );
    expectSingleMutation('approve');

    const currentEvent = {
      ...record('PENDING_REVIEW'),
      title: 'Current event after explicit recovery',
    };
    let releaseRead: ((event: EventRecord) => void) | undefined;
    // Angular's browser target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const heldRead = new Promise<EventRecord>((resolve) => {
      releaseRead = resolve;
    });
    loadEvent.mockReturnValueOnce(heldRead);
    try {
      buttonNamed(rootElement(), 'Try again').click();
      await vi.waitFor(() => {
        detectChanges();
        expect(loadEvent).toHaveBeenCalledTimes(4);
        expect(buttonNamed(rootElement(), 'Retrying…').disabled).toBe(true);
        expect(rootElement().textContent).toContain(
          'Some event information could not be refreshed.',
        );
      });
      expectSingleMutation('approve');
    } finally {
      releaseRead?.(currentEvent);
      await heldRead;
    }
    await vi.waitFor(async () => {
      await currentFixture.whenStable();
      detectChanges();
      expect(rootElement().querySelector(':scope h1')?.textContent).toContain(
        currentEvent.title,
      );
      expect(
        rootElement()
          .querySelector(':scope [data-testid="event-review-action-message"]')
          ?.textContent?.trim(),
      ).toBe('This event changed before the review was saved.');
      expect(pageButton('approve').disabled).toBe(false);
    });
    expect(rootElement().textContent).not.toContain(
      'Event could not be loaded',
    );
    expect(queryClient.getQueryData(eventKey('event-1'))).toEqual(currentEvent);
    expect(loadEvent.mock.calls).toEqual([
      ['event-1'],
      ['event-1'],
      ['event-1'],
      ['event-1'],
    ]);
    expect(errorNotice).toHaveBeenCalledTimes(1);
    expectSingleMutation('approve');
    expectNoSuccess();
  });

  it('retains the review conflict and comment across background reads until explicit detail recovery', async () => {
    await renderAction('returnToDraft');
    const conflictMessage = 'This event changed before the review was saved.';
    const combinedMessage =
      conflictMessage +
      ' Some event information could not be refreshed. Load this event again before making another change.';
    review.mockRejectedValueOnce(
      new EventConflictError({ message: conflictMessage }),
    );
    loadEvent.mockRejectedValueOnce(new Error('Conflict detail read failed.'));
    await confirmAction('returnToDraft');
    await expectFeedback(combinedMessage);
    expectSingleMutation('returnToDraft');

    await queryClient.refetchQueries(
      { exact: true, queryKey: eventKey('event-1') },
      { throwOnError: true },
    );
    await vi.waitFor(() => {
      detectChanges();
      expect(pageButton('returnToDraft').disabled).toBe(false);
      expect(loadEvent).toHaveBeenCalledTimes(3);
    });
    await expectFeedback(combinedMessage);

    loadEvent.mockRejectedValueOnce(new Error('Later detail read failed.'));
    await expect(
      queryClient.refetchQueries(
        { exact: true, queryKey: eventKey('event-1') },
        { throwOnError: true },
      ),
    ).rejects.toThrow('Later detail read failed.');
    await vi.waitFor(() => {
      detectChanges();
      expect(buttonNamed(rootElement(), 'Try again').disabled).toBe(false);
    });
    buttonNamed(rootElement(), 'Try again').click();
    await vi.waitFor(() => {
      detectChanges();
      expect(loadEvent).toHaveBeenCalledTimes(5);
      expect(
        rootElement()
          .querySelector(':scope [data-testid="event-review-action-message"]')
          ?.textContent?.trim(),
      ).toBe(conflictMessage);
      expect(pageButton('returnToDraft').disabled).toBe(false);
    });
    const dialog = await openAction('returnToDraft');
    expect(
      dialog.querySelector<HTMLTextAreaElement>(':scope textarea')?.value,
    ).toBe(comment);
    buttonNamed(dialog, 'Cancel').click();
    await fixture?.whenStable();
    expect(loadEvent.mock.calls.every(([id]) => id === 'event-1')).toBe(true);
    expect(errorNotice).toHaveBeenCalledExactlyOnceWith(combinedMessage);
    expectSingleMutation('returnToDraft');
    expectNoSuccess();
  });

  it.each(['returnToDraft', 'submit', 'discovery'] as const)(
    'does not submit the old %s dialog against another event after input reuse',
    async (action) => {
      const currentFixture = await renderAction(action);
      const dialog = await openAction(action);
      const nextEvent = {
        ...record('DRAFT'),
        id: 'event-2',
        title: 'Different workshop',
      };
      loadEvent.mockImplementation(async (id) =>
        id === 'event-2' ? nextEvent : record('PENDING_REVIEW'),
      );
      currentFixture.componentRef.setInput('eventId', 'event-2');
      await vi.waitFor(() => {
        detectChanges();
        expect(rootElement().querySelector(':scope h1')?.textContent).toContain(
          'Different workshop',
        );
      });
      await confirmOpenDialog(action, dialog);
      await vi.waitFor(() => {
        detectChanges();
        expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(0);
        expect(rootElement().getAttribute('aria-busy')).toBeNull();
      });
      expect(review).not.toHaveBeenCalled();
      expect(submitReview).not.toHaveBeenCalled();
      expect(changeDiscovery).not.toHaveBeenCalled();
      expectNoSuccess();
      expect(errorNotice).not.toHaveBeenCalled();
      expect(
        rootElement().querySelector(
          ':scope [data-testid="event-review-action-message"]',
        ),
      ).toBeNull();
      expect(queryClient.getQueryData(eventKey('event-2'))).toEqual(nextEvent);
    },
  );

  it('refreshes the original event and suppresses its completion notice after the page input changes', async () => {
    const currentFixture = await renderAction('approve');
    const nextEvent = {
      ...record('DRAFT'),
      id: 'event-2',
      title: 'Different workshop',
    };
    loadEvent.mockImplementation(async (id) =>
      id === 'event-2' ? nextEvent : record('PENDING_REVIEW'),
    );
    const originalOptions: ReturnType<EventDetailsOperations['findEvent']> = {
      queryFn: () => loadEvent('event-1'),
      queryKey: eventKey('event-1'),
    };
    const originalObserver = new QueryObserver(queryClient, originalOptions);
    let originalStatus = 'loading';
    let stopOriginal: (() => void) | undefined;
    const failures: unknown[] = [];
    let releaseMutation: (() => void) | undefined;
    // Angular's browser target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const heldMutation = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    try {
      stopOriginal = originalObserver.subscribe((result) => {
        originalStatus = result.status;
      });
      review.mockReturnValueOnce(heldMutation);
      await confirmAction('approve');
      await vi.waitFor(() => {
        expect(review).toHaveBeenCalledTimes(1);
      });
      currentFixture.componentRef.setInput('eventId', 'event-2');
      await vi.waitFor(() => {
        detectChanges();
        expect(rootElement().querySelector(':scope h1')?.textContent).toContain(
          'Different workshop',
        );
        expect(rootElement().getAttribute('aria-busy')).toBe('true');
        expect(pageButton('submit').disabled).toBe(true);
      });
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        releaseMutation?.();
      } catch (error) {
        failures.push(error);
      }
      try {
        await heldMutation;
      } catch (error) {
        failures.push(error);
      }
      try {
        await currentFixture.whenStable();
      } catch (error) {
        failures.push(error);
      }
      try {
        await vi.waitFor(() => {
          detectChanges();
          expect(rootElement().getAttribute('aria-busy')).toBeNull();
          expect(queryClient.isFetching()).toBe(0);
        });
      } catch (error) {
        failures.push(error);
      }
      try {
        stopOriginal?.();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Event review mutation ownership or cleanup failed.',
        { cause: failures[0] },
      );
    expectSingleMutation('approve');
    expect(originalStatus).toBe('success');
    expect(
      loadEvent.mock.calls.filter(([id]) => id === 'event-1'),
    ).toHaveLength(2);
    expect(
      loadEvent.mock.calls.filter(([id]) => id === 'event-2'),
    ).toHaveLength(1);
    expect(queryClient.getQueryData(eventKey('event-2'))).toEqual(nextEvent);
    expectNoSuccess();
    expect(errorNotice).not.toHaveBeenCalled();
    expect(
      rootElement().querySelector(
        ':scope [data-testid="event-review-action-message"]',
      ),
    ).toBeNull();
  });

  it('keeps the existing review-dialog caller without initial data empty and cancellable', async () => {
    await renderAction('approve');
    TestBed.inject(MatDialog).open(EventReviewDialogComponent);
    await vi.waitFor(() => {
      detectChanges();
      expect(
        dialogElement().querySelector<HTMLTextAreaElement>(':scope textarea')
          ?.value,
      ).toBe('');
    });
    expect(buttonNamed(dialogElement(), 'Return to draft').disabled).toBe(true);
    buttonNamed(dialogElement(), 'Cancel').click();
    await fixture?.whenStable();
    expect(review).not.toHaveBeenCalled();
    expectNoSuccess();
  });
});
