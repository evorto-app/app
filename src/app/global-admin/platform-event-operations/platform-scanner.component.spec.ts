import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
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
  platformGuestCheckInIssue,
  platformGuestCheckInSelection,
  platformRegistrationStatusIssueCopy,
  platformRegistrationStatusLabel,
  PlatformScannerComponent,
  PlatformScannerOperations,
  registrationIdFromPlatformScannerInput,
} from './platform-scanner.component';

describe('platformRegistrationStatusIssueCopy', () => {
  it('keeps confirmed registrations free of a status warning', () => {
    expect(platformRegistrationStatusIssueCopy('CONFIRMED')).toBeNull();
  });

  it('explains cancelled tickets without suggesting replacement payment or registration', () => {
    expect(platformRegistrationStatusIssueCopy('CANCELLED')).toEqual({
      body: 'This ticket was cancelled and cannot be checked in. Do not ask the attendee to pay or register again. If the cancellation or refund looks wrong, review the existing registration and refund instead of creating a replacement.',
      title: 'Registration cancelled',
    });
  });

  it('distinguishes pending approval or payment from a duplicate payment', () => {
    expect(platformRegistrationStatusIssueCopy('PENDING')).toEqual({
      body: 'This ticket is not confirmed yet and cannot be checked in. Ask the attendee to open the event or Profile to see whether organizer approval or their existing payment is still needed. Do not start a second registration or payment from the scanner.',
      title: 'Registration pending',
    });
  });

  it('explains that a waitlisted attendee has no confirmed spot', () => {
    expect(platformRegistrationStatusIssueCopy('WAITLIST')).toEqual({
      body: 'This attendee does not have a confirmed spot yet and cannot be checked in. Review the waitlist and capacity. Do not take payment or create another registration from the scanner.',
      title: 'Registration on waitlist',
    });
  });

  it('maps stored status codes to attendee-facing labels', () => {
    expect(platformRegistrationStatusLabel('CONFIRMED')).toBe('Confirmed');
    expect(platformRegistrationStatusLabel('PENDING')).toBe('Pending');
    expect(platformRegistrationStatusLabel('WAITLIST')).toBe('On waitlist');
    expect(platformRegistrationStatusLabel('CANCELLED')).toBe('Cancelled');
  });
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

  it('keeps lookup controls disabled until browser hydration completes', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-scanner.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-scanner.component.html',
      ),
      'utf8',
    );

    expect(source).toContain(
      'afterNextRender(() => this.lookupInteractive.set(true))',
    );
    expect(
      template.match(/\[disabled\]="!lookupInteractive\(\)"/g),
    ).toHaveLength(2);
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
  checkInTimingIssue: false,
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
  const listRegistrations = vi.fn(async () => []);
  const loadFormOptions = vi.fn(async () => ({
    timezone: 'Australia/Brisbane',
  }));
  let queryClient: QueryClient;

  beforeEach(async () => {
    findRegistration.mockReset().mockResolvedValue(inspectedRegistration);
    listRegistrations.mockReset().mockResolvedValue([]);
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
              mutationFn: vi.fn(),
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
            list: () => ({
              queryFn: listRegistrations,
              queryKey: ['platform-scanner', 'registrations'],
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
        'This registration could not be loaded.',
      );
    });
    expect(findRegistration).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).not.toContain('Provider secret');

    const retryButton = findAlertButton(
      fixture,
      'This registration could not be loaded.',
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

  it('retries a failed registrations list', async () => {
    listRegistrations
      .mockReset()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue([]);
    const fixture = renderInitial();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        'Registrations for this organization could not be loaded.',
      );
    });
    expect(listRegistrations).toHaveBeenCalledOnce();

    const retryButton = findAlertButton(
      fixture,
      'Registrations for this organization could not be loaded.',
    );
    if (!retryButton) throw new Error('Expected a registrations retry button');
    retryButton.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(listRegistrations).toHaveBeenCalledTimes(2);
      expect(fixture.nativeElement.textContent).toContain(
        'No registrations found.',
      );
    });
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
        '02 Jan 2030, 10:00 · Australia/Brisbane',
      );
    });
  });

  it('formats operational dates in the target tenant timezone', async () => {
    const fixture = await render();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        '02 Jan 2030, 10:00 · Australia/Brisbane',
      );
      expect(fixture.nativeElement.textContent).toContain(
        '01 Jan 2030, 10:00 · Australia/Brisbane',
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
  });

  it('does not cancel when the administrator keeps the registration', async () => {
    const fixture = await render();

    findButton(fixture, 'Cancel registration')?.click();

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

  it('cancels only after explicit confirmation', async () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });
    const fixture = await render();

    findButton(fixture, 'Cancel registration')?.click();

    await vi.waitFor(() => expect(cancelRegistration).toHaveBeenCalledOnce());
    expect(cancelRegistration.mock.calls[0]?.[0]).toEqual({
      reason: 'Duplicate registration',
      registrationId: 'registration-1',
      targetTenantId: 'tenant-1',
    });
  });
});
