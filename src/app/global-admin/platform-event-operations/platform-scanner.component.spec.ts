import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter, Router } from '@angular/router';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PlatformRegistrationDetailRecord,
  PlatformRegistrationsCancelInput,
  PlatformRegistrationsCheckInInput,
} from '../../../shared/rpc-contracts/app-rpcs/platform-events.rpcs';

import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';
import { PlatformRegistrationCancellationConfirmationDialogComponent } from './platform-registration-cancellation-confirmation-dialog.component';
import {
  platformCheckInTimingIssueCopy,
  platformGuestCheckInIssue,
  platformGuestCheckInSelection,
  platformRegistrationCancellationActionLabel,
  platformRegistrationStatusIssueCopy,
  platformRegistrationStatusLabel,
  PlatformScannerComponent,
  platformScannerNavigationErrorMessage,
  PlatformScannerOperations,
  registrationIdFromPlatformScannerInput,
} from './platform-scanner.component';

describe('platformCheckInTimingIssueCopy', () => {
  it('distinguishes not-yet-open check-in from an ended window', () => {
    expect(platformCheckInTimingIssueCopy('notOpen')).toEqual({
      body: 'Check-in opens one hour before the event starts.',
      title: 'Check-in not open',
    });
    expect(platformCheckInTimingIssueCopy('ended')).toEqual({
      body: 'The event ended more than two hours ago, so check-in is closed. The attendee was not checked in.',
      title: 'Check-in closed',
    });
    expect(platformCheckInTimingIssueCopy(null)).toBeNull();
  });
});

describe('platformRegistrationStatusIssueCopy', () => {
  it('keeps confirmed registrations free of a status warning', () => {
    expect(platformRegistrationStatusIssueCopy('CONFIRMED')).toBeNull();
  });

  it('explains an ended sign-up without guessing its former state', () => {
    expect(platformRegistrationStatusIssueCopy('CANCELLED')).toEqual({
      body: 'This sign-up has ended and cannot be checked in. Do not ask the attendee to pay or sign up again. If the cancellation or refund looks wrong, review the existing sign-up instead of creating a replacement.',
      title: 'Sign-up ended',
    });
  });

  it('distinguishes pending approval or payment from a duplicate payment', () => {
    expect(platformRegistrationStatusIssueCopy('PENDING')).toEqual({
      body: 'This ticket is not confirmed yet and cannot be checked in. Ask the attendee to open the event or Profile to see whether organizer approval or their existing payment is still needed. Do not start another sign-up or payment here.',
      title: 'Sign-up pending',
    });
  });

  it('explains that a waitlisted attendee has no confirmed place', () => {
    expect(platformRegistrationStatusIssueCopy('WAITLIST')).toEqual({
      body: 'This attendee does not have a confirmed place yet and cannot be checked in. Review the waitlist and available places. Do not take payment or start another sign-up here.',
      title: 'On waitlist',
    });
  });

  it('maps stored status codes to attendee-facing labels', () => {
    expect(platformRegistrationStatusLabel('CONFIRMED')).toBe('Confirmed');
    expect(platformRegistrationStatusLabel('PENDING')).toBe('Pending');
    expect(platformRegistrationStatusLabel('WAITLIST')).toBe('On waitlist');
    expect(platformRegistrationStatusLabel('CANCELLED')).toBe('Cancelled');
  });
});

describe('platformRegistrationCancellationActionLabel', () => {
  it.each([
    ['PENDING', false, 'Withdraw application'],
    ['PENDING', true, 'Cancel sign-up'],
    ['WAITLIST', false, 'Remove from waitlist'],
    ['CONFIRMED', false, 'Cancel ticket'],
    ['CANCELLED', false, 'Sign-up ended'],
  ] as const)(
    'describes %s without guessing ticket state',
    (status, paymentPending, expected) => {
      expect(
        platformRegistrationCancellationActionLabel({ paymentPending, status }),
      ).toBe(expected);
    },
  );
});

describe('platform guest check-in selection', () => {
  it('accepts only whole guest counts within the remaining quantity', () => {
    expect(
      platformGuestCheckInSelection({
        inputValue: '2',
        remainingGuestCount: 3,
      }),
    ).toEqual({ count: 2, error: '' });

    for (const inputValue of ['', '-1', '1.5', '4', 'not-a-number']) {
      expect(
        platformGuestCheckInSelection({
          inputValue,
          remainingGuestCount: 3,
        }),
      ).toEqual({
        count: 0,
        error: 'Enter a whole number from 0 to 3.',
      });
    }
  });

  it('requires at least one guest when the attendee is already checked in', () => {
    expect(
      platformGuestCheckInIssue({
        attendeeCheckedIn: true,
        selection: { count: 0, error: '' },
      }),
    ).toBe('Choose at least one guest to check in.');
    expect(
      platformGuestCheckInIssue({
        attendeeCheckedIn: false,
        selection: { count: 0, error: '' },
      }),
    ).toBe('');
  });
});

describe('registrationIdFromPlatformScannerInput', () => {
  it('accepts a raw registration id', () => {
    expect(registrationIdFromPlatformScannerInput(' registration-1 ')).toBe(
      'registration-1',
    );
  });

  it('extracts an attendee ticket URL without trusting its origin', () => {
    expect(
      registrationIdFromPlatformScannerInput(
        'https://tenant.example/scan/registration/registration-1',
      ),
    ).toBe('registration-1');
  });

  it('rejects unrelated or ambiguous paths', () => {
    expect(
      registrationIdFromPlatformScannerInput(
        'https://tenant.example/events/registration-1',
      ),
    ).toBeUndefined();
    expect(
      registrationIdFromPlatformScannerInput(
        'https://tenant.example/scan/registration/registration-1/extra',
      ),
    ).toBeUndefined();
    expect(
      registrationIdFromPlatformScannerInput('registration/one'),
    ).toBeUndefined();
  });
});

@Component({
  selector: 'app-platform-tenant-page-header',
  template: '',
})
class PlatformTenantPageHeaderStub {
  readonly tenantId = input.required<string>();
  readonly title = input.required<string>();
}

const inspectedRegistration: PlatformRegistrationDetailRecord = {
  allowCheckIn: true,
  attendee: {
    email: 'alex@example.test',
    firstName: 'Alex',
    id: 'user-1',
    lastName: 'Able',
  },
  attendeeCheckedIn: false,
  cancellation: {
    available: true,
    blockedReason: null,
    deadline: '2030-01-01T00:00:00.000Z',
    deadlinePassed: false,
    refund: {
      amount: 1250,
      feesIncluded: false,
      method: 'stripe',
      required: true,
    },
  },
  checkedInGuestCount: 0,
  checkInTime: null,
  checkInTimingIssue: null,
  currency: 'EUR',
  event: {
    id: 'event-1',
    start: '2030-01-02T00:00:00.000Z',
    title: 'Weekend trip',
  },
  guestCount: 2,
  id: 'registration-1',
  manualApprovalAvailable: false,
  paymentPending: false,
  registrationMode: 'fcfs',
  registrationOptionTitle: 'Participant',
  registrationStatusIssue: false,
  remainingGuestCount: 2,
  status: 'CONFIRMED',
};

const findButton = (
  fixture: ComponentFixture<PlatformScannerComponent>,
  label: string,
): HTMLButtonElement | undefined =>
  [
    ...(
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('button'),
  ].find(
    (button) => button.textContent?.replaceAll(/\s+/g, ' ').trim() === label,
  );

const findAlertButton = (
  fixture: ComponentFixture<PlatformScannerComponent>,
  alertText: string,
): HTMLButtonElement | undefined =>
  [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      '[role="alert"]',
    ),
  ]
    .find((alert) => alert.textContent?.includes(alertText))
    ?.querySelector<HTMLButtonElement>('button') ?? undefined;

describe('PlatformScannerComponent', () => {
  const approveRegistration = vi.fn(
    async (): Promise<PlatformRegistrationDetailRecord> =>
      inspectedRegistration,
  );
  const cancelRegistration = vi.fn(
    async (
      _input: PlatformRegistrationsCancelInput,
      _context?: unknown,
    ): Promise<PlatformRegistrationDetailRecord> => inspectedRegistration,
  );
  const checkInRegistration = vi.fn(
    async (
      _input: PlatformRegistrationsCheckInInput,
      _context?: unknown,
    ): Promise<PlatformRegistrationDetailRecord> => inspectedRegistration,
  );
  const dialogOpen = vi.fn(() => ({ afterClosed: () => of(false) }));
  const findRegistration = vi.fn(
    async (): Promise<PlatformRegistrationDetailRecord> =>
      inspectedRegistration,
  );
  const loadFormOptions = vi.fn(async () => ({
    timezone: 'Australia/Brisbane',
  }));
  let queryClient: QueryClient;

  beforeEach(async () => {
    approveRegistration.mockReset().mockResolvedValue(inspectedRegistration);
    findRegistration.mockReset().mockResolvedValue(inspectedRegistration);
    loadFormOptions.mockReset().mockResolvedValue({
      timezone: 'Australia/Brisbane',
    });
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    TestBed.overrideComponent(PlatformScannerComponent, {
      add: { imports: [PlatformTenantPageHeaderStub] },
      remove: { imports: [PlatformTenantPageHeaderComponent] },
    });
    await TestBed.configureTestingModule({
      imports: [PlatformScannerComponent],
      providers: [
        provideTanStackQuery(queryClient),
        provideRouter([]),
        { provide: MatDialog, useValue: { open: dialogOpen } },
        {
          provide: NotificationService,
          useValue: { showError: vi.fn(), showSuccess: vi.fn() },
        },
        {
          provide: PlatformScannerOperations,
          useValue: {
            approve: () => ({
              mutationFn: approveRegistration,
              mutationKey: ['platform-scanner', 'approve'],
            }),
            cancel: () => ({
              mutationFn: cancelRegistration,
              mutationKey: ['platform-scanner', 'cancel'],
            }),
            checkIn: () => ({
              mutationFn: checkInRegistration,
              mutationKey: ['platform-scanner', 'check-in'],
            }),
            findOne: () => ({
              queryFn: findRegistration,
              queryKey: ['platform-scanner', 'registration'],
            }),
            formOptions: () => ({
              queryFn: loadFormOptions,
              queryKey: ['platform-scanner', 'target-tenant-options'],
            }),
            registrationFilter: () => ({
              queryKey: ['platform-scanner', 'registration'],
            }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    dialogOpen.mockReturnValue({ afterClosed: () => of(false) });
    TestBed.resetTestingModule();
  });

  const render = async (): Promise<
    ComponentFixture<PlatformScannerComponent>
  > => {
    const fixture = renderInitial('registration-1');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Weekend trip');
    });
    const reason = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLTextAreaElement>('textarea');
    if (!reason) throw new Error('Expected an operational-reason field');
    reason.value = 'Duplicate registration';
    reason.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    return fixture;
  };

  const renderInitial = (
    registrationId?: string,
  ): ComponentFixture<PlatformScannerComponent> => {
    const fixture = TestBed.createComponent(PlatformScannerComponent);
    if (registrationId) {
      fixture.componentRef.setInput('registrationId', registrationId);
    }
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.detectChanges();
    return fixture;
  };

  it('does not preload registrations before an explicit lookup', async () => {
    const fixture = renderInitial();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector<HTMLInputElement>('input');
    const submit = root.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );

    expect(findRegistration).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(input?.disabled).toBe(false);
      expect(submit?.disabled).toBe(false);
    });
    expect(findRegistration).not.toHaveBeenCalled();
  });

  it('retries a failed registration lookup', async () => {
    findRegistration
      .mockReset()
      .mockRejectedValueOnce(
        new Error('Provider secret and registration-1 must never render'),
      )
      .mockResolvedValue(inspectedRegistration);
    const fixture = renderInitial('registration-1');

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        'This ticket could not be loaded.',
      );
    });
    expect(findRegistration).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).not.toContain('Provider secret');

    const retryButton = findAlertButton(
      fixture,
      'This ticket could not be loaded.',
    );
    if (!retryButton) throw new Error('Expected a registration retry button');
    retryButton.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findRegistration).toHaveBeenCalledTimes(2);
      expect(fixture.nativeElement.textContent).toContain('Weekend trip');
      expect(fixture.nativeElement.textContent).not.toContain('registration-1');
    });
  });

  it('surfaces failed lookup navigation and keeps an explicit retry action', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(false);
    const fixture = renderInitial();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const input = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLInputElement>('input');
      expect(input?.disabled).toBe(false);
    });
    const input = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input');
    if (!input) throw new Error('Expected a registration lookup input');
    input.value = 'registration-1';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    findButton(fixture, 'Open ticket')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const alert = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLElement>('[role="alert"]');
      expect(alert?.textContent).toContain(
        platformScannerNavigationErrorMessage,
      );
      expect(findButton(fixture, 'Try opening ticket again')?.disabled).toBe(
        false,
      );
    });
    expect(navigate).toHaveBeenCalledWith([
      '/global-admin/tenants',
      'tenant-1',
      'scanner',
      'registration-1',
    ]);

    navigate.mockResolvedValue(true);
    findButton(fixture, 'Try opening ticket again')?.click();

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
    expect(navigate).toHaveBeenLastCalledWith([
      '/global-admin/tenants',
      'tenant-1',
      'scanner',
      'registration-1',
    ]);
  });

  it('retries loading the organization time zone', async () => {
    loadFormOptions
      .mockReset()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue({ timezone: 'Australia/Brisbane' });
    const fixture = renderInitial('registration-1');

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        "Dates cannot be shown in the organization's time zone right now.",
      );
    });
    expect(loadFormOptions).toHaveBeenCalledOnce();

    const retryButton = findAlertButton(
      fixture,
      "Dates cannot be shown in the organization's time zone right now.",
    );
    if (!retryButton) throw new Error('Expected a time-zone retry button');
    retryButton.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(loadFormOptions).toHaveBeenCalledTimes(2);
      expect(fixture.nativeElement.textContent).toContain(
        '02 Jan 2030, 10:00 · Brisbane time',
      );
    });
  });

  it('formats operational dates in the target tenant timezone', async () => {
    const fixture = await render();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        '02 Jan 2030, 10:00 · Brisbane time',
      );
      expect(fixture.nativeElement.textContent).toContain(
        '01 Jan 2030, 10:00 · Brisbane time',
      );
      expect(fixture.nativeElement.textContent).not.toContain(
        'Australia/Brisbane',
      );
    });
  });

  it('clears action state when the inspected registration changes', async () => {
    const fixture = await render();
    const guestCount = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input[type="number"]');
    if (!guestCount) throw new Error('Expected a guest-count field');
    guestCount.value = '2';
    guestCount.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    fixture.componentRef.setInput('registrationId', 'registration-2');
    fixture.detectChanges();

    const reason = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLTextAreaElement>('textarea');
    expect(reason?.value).toBe('');
    expect(guestCount.value).toBe('0');
  });

  it('explains invalid guest quantities and keeps check-in disabled', async () => {
    const fixture = await render();
    const guestCount = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input[type="number"]');
    if (!guestCount) throw new Error('Expected a guest-count field');

    guestCount.value = '1.5';
    guestCount.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Enter a whole number from 0 to 2.',
    );
    expect(findButton(fixture, 'Check in')?.disabled).toBe(true);

    guestCount.value = '1';
    guestCount.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(findButton(fixture, 'Check in')?.disabled).toBe(false);
  });

  it('clears the reason and guest count after a successful check-in', async () => {
    const fixture = await render();
    const notifications = TestBed.inject(NotificationService);
    const guestCount = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input[type="number"]');
    if (!guestCount) throw new Error('Expected a guest-count field');
    guestCount.value = '2';
    guestCount.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    findButton(fixture, 'Check in')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(checkInRegistration).toHaveBeenCalledOnce();
      const reason = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLTextAreaElement>('textarea');
      expect(reason?.value).toBe('');
      expect(guestCount.value).toBe('0');
    });
    expect(checkInRegistration.mock.calls[0]?.[0]).toEqual({
      guestCheckInCount: 2,
      reason: 'Duplicate registration',
      registrationId: 'registration-1',
      targetTenantId: 'tenant-1',
    });
    expect(notifications.showSuccess).toHaveBeenCalledWith('Ticket checked in');
  });

  it('shows an expected approval outcome', async () => {
    findRegistration.mockResolvedValue({
      ...inspectedRegistration,
      manualApprovalAvailable: true,
    });
    approveRegistration.mockRejectedValue({
      _tag: 'RpcBadRequestError',
      message: 'This registration no longer needs approval.',
    });
    const fixture = await render();
    const notifications = TestBed.inject(NotificationService);

    findButton(fixture, 'Approve')?.click();

    await vi.waitFor(() => {
      expect(approveRegistration).toHaveBeenCalledOnce();
      expect(notifications.showError).toHaveBeenCalledWith(
        'This registration no longer needs approval.',
      );
    });
  });

  it('does not cancel when the administrator keeps the registration', async () => {
    const fixture = await render();

    findButton(fixture, 'Cancel ticket')?.click();

    await vi.waitFor(() => expect(dialogOpen).toHaveBeenCalledOnce());
    expect(dialogOpen).toHaveBeenCalledWith(
      PlatformRegistrationCancellationConfirmationDialogComponent,
      expect.objectContaining({
        data: {
          reason: 'Duplicate registration',
          registration: inspectedRegistration,
        },
      }),
    );
    expect(cancelRegistration).not.toHaveBeenCalled();
  });

  it('describes attendee cancellation updates as an attempt', async () => {
    const fixture = await render();
    const text = (fixture.nativeElement as HTMLElement).textContent
      ?.replaceAll(/\s+/g, ' ')
      .trim();

    expect(text).toContain('tries to send the attendee an update');
    expect(text).not.toContain('notifies the attendee');
  });

  it('cancels only after explicit confirmation', async () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });
    const fixture = await render();
    const notifications = TestBed.inject(NotificationService);

    findButton(fixture, 'Cancel ticket')?.click();

    await vi.waitFor(() => expect(cancelRegistration).toHaveBeenCalledOnce());
    expect(cancelRegistration.mock.calls[0]?.[0]).toEqual({
      expectedPaymentPending: false,
      expectedStatus: 'CONFIRMED',
      reason: 'Duplicate registration',
      registrationId: 'registration-1',
      targetTenantId: 'tenant-1',
    });
    expect(notifications.showSuccess).toHaveBeenCalledWith('Ticket cancelled');
  });
});
