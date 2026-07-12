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
} from '../../../shared/rpc-contracts/app-rpcs/platform-events.rpcs';

import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';
import { PlatformRegistrationCancellationConfirmationDialogComponent } from './platform-registration-cancellation-confirmation-dialog.component';
import {
  platformRegistrationStatusIssueCopy,
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

  it('distinguishes pending approval or Checkout from a duplicate payment', () => {
    expect(platformRegistrationStatusIssueCopy('PENDING')).toEqual({
      body: 'This ticket is not confirmed yet and cannot be checked in. Ask the attendee to open the event or Profile to see whether organizer approval or their existing Stripe Checkout is still needed. Do not start a second registration or payment from the scanner.',
      title: 'Registration pending',
    });
  });

  it('explains that a waitlisted attendee has no confirmed spot', () => {
    expect(platformRegistrationStatusIssueCopy('WAITLIST')).toEqual({
      body: 'This attendee does not have a confirmed spot yet and cannot be checked in. Review the waitlist and capacity. Do not take payment or create another registration from the scanner.',
      title: 'Registration on waitlist',
    });
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

describe('PlatformScannerComponent cancellation confirmation', () => {
  const cancelRegistration = vi.fn(
    async (
      _input: PlatformRegistrationsCancelInput,
      _context?: unknown,
    ): Promise<PlatformRegistrationDetailRecord> => inspectedRegistration,
  );
  const dialogOpen = vi.fn(() => ({ afterClosed: () => of(false) }));
  let queryClient: QueryClient;

  beforeEach(async () => {
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
              mutationFn: vi.fn(),
              mutationKey: ['platform-scanner', 'check-in'],
            }),
            findOne: () => ({
              queryFn: async () => inspectedRegistration,
              queryKey: ['platform-scanner', 'registration'],
            }),
            list: () => ({
              queryFn: async () => [],
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
    const fixture = TestBed.createComponent(PlatformScannerComponent);
    fixture.componentRef.setInput('registrationId', 'registration-1');
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.detectChanges();
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
