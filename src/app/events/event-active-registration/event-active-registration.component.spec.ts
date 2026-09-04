import '@angular/compiler';
import type {
  EventsRegistrationAddonRecord,
  EventsRegistrationStatusRecord,
} from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/events.errors';
import {
  RegistrationTransferConflictError,
  RegistrationTransferInternalError,
  RegistrationTransferNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/registration-transfers.errors';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import {
  clampRegistrationAddonQuantity,
  reconcileRegistrationAddonPurchaseAttempts,
  registrationAddonPurchaseBlockedCopy,
  resolveRegistrationAddonPurchaseAttempt,
} from './event-active-registration-addon-purchase';
import {
  EventActiveRegistrationComponent,
  EventActiveRegistrationOperations,
  recipientTransferCheckoutPending,
  registrationActiveTransferStatusCopy,
  registrationAudienceCopy,
  registrationCancellationActionDisabled,
  registrationCancellationCopy,
  registrationDeferredActionCopy,
  registrationTransferActionCopy,
  registrationTransferActionDisabled,
  registrationTransferBlockedCopy,
} from './event-active-registration.component';

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(process.cwd(), sourcePath), 'utf8');

const registrationAddon = (
  overrides: Partial<EventsRegistrationAddonRecord> = {},
): EventsRegistrationAddonRecord => ({
  addOnId: 'addon-1',
  allowMultiple: true,
  allowPurchaseBeforeEvent: true,
  allowPurchaseDuringEvent: true,
  cancelledQuantity: 0,
  currency: 'EUR',
  currentPurchaseWindow: 'beforeEvent',
  description: 'A useful add-on',
  includedQuantity: 0,
  isPaid: false,
  maxPurchasableQuantity: 3,
  maxQuantityPerUser: 3,
  nextPurchaseTaxRateDisplayName: null,
  nextPurchaseTaxRateInclusive: null,
  nextPurchaseTaxRatePercentage: null,
  nextPurchaseUnitGrossAmount: 0,
  nextPurchaseUnitPrice: 0,
  nextPurchaseUnitTaxAmount: 0,
  optionalPurchaseQuantity: 3,
  pendingCheckoutExpired: false,
  pendingCheckoutExpiresAt: null,
  pendingCheckoutUrl: null,
  pendingOperationKey: null,
  pendingQuantity: 0,
  purchaseAvailable: true,
  purchaseBlockedReason: 'none',
  purchaseStatus: 'available',
  redeemedQuantity: 0,
  remainingQuantity: 0,
  settledPurchasedQuantity: 0,
  title: 'Welcome dinner',
  totalAvailableQuantity: 8,
  totalQuantity: 0,
  ...overrides,
});

const registrationStatus = (
  overrides: Partial<EventsRegistrationStatusRecord> = {},
): EventsRegistrationStatusRecord => ({
  activeTransfer: null,
  addonPurchases: [],
  appliedDiscountedPrice: null,
  appliedDiscountType: null,
  basePriceAtRegistration: 0,
  cancellationAvailable: true,
  cancellationBlockedReason: 'none',
  checkoutUrl: null,
  discountAmount: 0,
  guestCount: 0,
  id: 'registration-1',
  organizingRegistration: false,
  paymentPending: false,
  registeredDescription: null,
  registrationAddOns: [registrationAddon()],
  registrationOptionId: 'option-1',
  registrationOptionTitle: 'Participant',
  status: 'CONFIRMED',
  transferAvailable: true,
  transferBlockedReason: 'none',
  ...overrides,
});

describe('registrationCancellationCopy', () => {
  it('describes pending payment cancellation as releasing reserved places', () => {
    expect(
      registrationCancellationCopy({
        activeTransfer: null,
        cancellationAvailable: true,
        cancellationBlockedReason: 'none',
        guestCount: 2,
        paymentPending: true,
        status: 'PENDING',
      }),
    ).toEqual({
      buttonLabel: 'Cancel sign-up',
      helperText:
        'This cancels the pending sign-up and releases all selected places. It does not complete a payment.',
    });
  });

  it('distinguishes withdrawing an application from cancelling a payment', () => {
    expect(
      registrationCancellationCopy({
        activeTransfer: null,
        cancellationAvailable: true,
        cancellationBlockedReason: 'none',
        guestCount: 0,
        paymentPending: false,
        status: 'PENDING',
      }),
    ).toEqual({
      buttonLabel: 'Withdraw application',
      helperText:
        'This withdraws your pending application before organizer approval.',
    });
  });

  it('describes confirmed cancellation and Stripe refund handling', () => {
    expect(
      registrationCancellationCopy({
        activeTransfer: null,
        cancellationAvailable: true,
        cancellationBlockedReason: 'none',
        guestCount: 0,
        paymentPending: false,
        status: 'CONFIRMED',
      }),
    ).toEqual({
      buttonLabel: 'Cancel ticket',
      helperText:
        'This cancels your ticket and releases your place. If a refund applies, Evorto starts it automatically after cancellation. It may take time to appear; do not pay or sign up again to retry it.',
    });
  });

  it('does not expose generic cancellation for recipient transfer checkout', () => {
    const registration = {
      activeTransfer: {
        expiresAt: '2030-05-01T12:00:00.000Z',
        refundLifecycle: null,
        registrationSide: 'recipient' as const,
        status: 'checkout_pending' as const,
        transferId: 'transfer-1',
      },
      cancellationAvailable: true,
      cancellationBlockedReason: 'none' as const,
      guestCount: 1,
      paymentPending: true,
      status: 'PENDING' as const,
    };

    expect(recipientTransferCheckoutPending(registration)).toBe(true);
    expect(registrationCancellationCopy(registration)).toBeNull();
  });

  it('explains a passed cancellation deadline without presenting an action', () => {
    expect(
      registrationCancellationCopy({
        activeTransfer: null,
        cancellationAvailable: false,
        cancellationBlockedReason: 'deadlinePassed',
        guestCount: 0,
        paymentPending: false,
        status: 'CONFIRMED',
      }),
    ).toEqual({
      buttonLabel: null,
      helperText:
        'The cancellation deadline has passed. Your ticket is still active, no place has been released, and no refund has started.',
    });
  });
});

describe('registrationAudienceCopy', () => {
  it('labels confirmed organizer/helper access and its QR pass explicitly', () => {
    expect(
      registrationAudienceCopy(
        registrationStatus({ organizingRegistration: true }),
      ),
    ).toEqual({
      audienceLabel: 'Organizer/helper',
      confirmedStatus: 'Organizer/helper ticket confirmed',
      passHeading: 'Your organizer/helper pass',
      paymentPendingStatus:
        'Complete payment to confirm your organizer/helper place. Organizer access starts only after payment succeeds.',
      pendingApprovalStatus:
        'Organizer/helper application pending. Organizer access starts only after approval and any required payment.',
      qrAlt: 'QR code for the organizer/helper pass',
    });
  });

  it('keeps explicit organizer/helper confirmation visible beside custom registered copy', () => {
    const template = readSource(
      'src/app/events/event-active-registration/event-active-registration.component.html',
    );

    expect(template).toContain('{{ audience.confirmedStatus }}');
    expect(template).toContain('@if (registration.registeredDescription)');
    expect(template).not.toContain(
      '@if (registration.registeredDescription) {\n          <div\n            class="prose dark:prose-invert max-w-none @md:col-span-2"\n            [innerHtml]="registration.registeredDescription"\n          ></div>\n        } @else',
    );
  });
});

describe('registration transfer copy', () => {
  it('keeps transfer and resale unavailable for pending or waitlist registrations', () => {
    expect(registrationDeferredActionCopy({ status: 'PENDING' })).toBe(
      'Transfer/resale is not available for pending registrations.',
    );
    expect(registrationDeferredActionCopy({ status: 'WAITLIST' })).toBe(
      'Transfer/resale is not available for waitlist registrations.',
    );
  });

  it('explains a pending add-on payment transfer block', () => {
    expect(registrationTransferBlockedCopy('addonPaymentPending')).toContain(
      'available add-on payment',
    );
  });

  it('uses the exact server reason when a confirmed transfer is blocked', () => {
    expect(
      registrationTransferActionCopy({
        status: 'CONFIRMED',
        transferAvailable: false,
        transferBlockedReason: 'addonPaymentPending',
      }),
    ).toEqual({
      buttonLabel: 'Transfer unavailable',
      helperText:
        'Finish an available add-on payment, or wait for that payment page to expire, before transferring this ticket. If no payment link is available, contact an organizer to review it.',
    });
  });

  it('does not offer transfer cancellation during refund reconciliation', () => {
    const refundPending = registrationActiveTransferStatusCopy({
      expiresAt: '2030-05-01T12:00:00.000Z',
      refundLifecycle: { state: 'processing' },
      registrationSide: 'source',
      status: 'refund_pending',
      transferId: 'transfer-1',
    });
    const refundFailed = registrationActiveTransferStatusCopy({
      expiresAt: '2030-05-01T12:00:00.000Z',
      refundLifecycle: { state: 'needsAttention' },
      registrationSide: 'recipient',
      status: 'refund_failed',
      transferId: 'transfer-1',
    });

    expect(refundPending).toMatchObject({
      cancelLabel: null,
      showExpiry: false,
      title: 'Transfer refund is processing',
      tone: 'success',
    });
    expect(refundFailed).toMatchObject({
      cancelLabel: null,
      showExpiry: false,
      title: 'Transfer refund needs attention',
      tone: 'error',
    });
    expect(refundFailed.body).toContain('your ticket remains confirmed');
  });

  it('does not describe refunds needing follow-up as processing', () => {
    const actionRequired = registrationActiveTransferStatusCopy({
      expiresAt: '2030-05-01T12:00:00.000Z',
      refundLifecycle: { state: 'actionRequired' },
      registrationSide: 'source',
      status: 'refund_pending',
      transferId: 'transfer-1',
    });
    const stopped = registrationActiveTransferStatusCopy({
      expiresAt: '2030-05-01T12:00:00.000Z',
      refundLifecycle: { state: 'needsAttention' },
      registrationSide: 'recipient',
      status: 'refund_pending',
      transferId: 'transfer-1',
    });

    expect(actionRequired.title).toBe('Transfer refund needs attention');
    expect(actionRequired.tone).toBe('error');
    expect(actionRequired.body).not.toContain('being processed');
    expect(actionRequired.body).toContain('contact an organizer');
    expect(actionRequired.body).not.toContain('provider-side');
    expect(stopped.title).toBe('Transfer refund needs attention');
    expect(stopped.tone).toBe('error');
    expect(stopped.body).toContain('ticket remains confirmed');
    expect(stopped.body).not.toContain('platform-administrator');
  });
});

describe('registration action guards', () => {
  it('disables cancellation and transfer during an add-on write', () => {
    expect(
      registrationCancellationActionDisabled({
        addonPurchasePending: true,
        cancellationPending: false,
        transferPending: false,
      }),
    ).toBe(true);
    expect(
      registrationTransferActionDisabled({
        addonPurchasePending: true,
        cancellationPending: false,
        transferAvailable: true,
        transferPending: false,
      }),
    ).toBe(true);
  });

  it('allows otherwise eligible actions when no write is pending', () => {
    expect(
      registrationCancellationActionDisabled({
        addonPurchasePending: false,
        cancellationPending: false,
        transferPending: false,
      }),
    ).toBe(false);
    expect(
      registrationTransferActionDisabled({
        addonPurchasePending: false,
        cancellationPending: false,
        transferAvailable: true,
        transferPending: false,
      }),
    ).toBe(false);
  });
});

describe('registration add-on purchase helpers', () => {
  it.each([
    ['registrationStatus', 'ticket is confirmed'],
    ['eventUnavailable', 'not available'],
    ['activeTransfer', 'active transfer'],
    ['paymentPending', 'already in progress'],
    ['beforeEventDisabled', 'not sold before'],
    ['duringEventDisabled', 'not sold during'],
    ['eventEnded', 'event has ended'],
    ['multipleNotAllowed', 'only once'],
    ['optionLimitReached', 'maximum number of this add-on'],
    ['userLimitReached', 'per-person limit'],
    ['outOfStock', 'sold out'],
    ['paymentUnavailable', 'Online payment'],
    ['taxUnavailable', 'tax details are no longer available'],
  ] as const)('explains %s without guessing client state', (reason, copy) => {
    expect(registrationAddonPurchaseBlockedCopy(reason)).toContain(copy);
  });

  it('clamps quantity to whole-number server bounds', () => {
    expect(clampRegistrationAddonQuantity(NaN, 4)).toBe(1);
    expect(clampRegistrationAddonQuantity(-2, 4)).toBe(1);
    expect(clampRegistrationAddonQuantity(2.8, 4)).toBe(2);
    expect(clampRegistrationAddonQuantity(12, 4)).toBe(4);
  });

  it('reuses an existing key for the same quantity and creates a key after quantity changes', () => {
    const createOperationKey = vi.fn(() => 'new-operation-key');
    const addOn = registrationAddon();

    expect(
      resolveRegistrationAddonPurchaseAttempt({
        addOn,
        createOperationKey,
        existingAttempt: {
          operationKey: 'existing-key',
          quantity: 2,
          source: 'local',
        },
        quantity: 2,
      }),
    ).toEqual({ operationKey: 'existing-key', quantity: 2, source: 'local' });
    expect(createOperationKey).not.toHaveBeenCalled();

    expect(
      resolveRegistrationAddonPurchaseAttempt({
        addOn,
        createOperationKey,
        existingAttempt: {
          operationKey: 'existing-key',
          quantity: 2,
          source: 'local',
        },
        quantity: 3,
      }),
    ).toEqual({
      operationKey: 'new-operation-key',
      quantity: 3,
      source: 'local',
    });
  });

  it('adopts the owner query key and quantity for pending checkout recovery', () => {
    const pendingAddOn = registrationAddon({
      maxPurchasableQuantity: 0,
      pendingOperationKey: 'canonical-key',
      pendingQuantity: 2,
      purchaseAvailable: false,
      purchaseBlockedReason: 'paymentPending',
      purchaseStatus: 'paymentPending',
    });

    expect(
      resolveRegistrationAddonPurchaseAttempt({
        addOn: pendingAddOn,
        createOperationKey: () => 'unused-key',
        existingAttempt: {
          operationKey: 'stale-key',
          quantity: 1,
          source: 'local',
        },
        quantity: 1,
      }),
    ).toEqual({
      operationKey: 'canonical-key',
      quantity: 2,
      source: 'canonical',
    });
    expect(
      reconcileRegistrationAddonPurchaseAttempts(
        {
          'registration-2:addon-2': {
            operationKey: 'ambiguous-local-key',
            quantity: 1,
            source: 'local',
          },
        },
        [registrationStatus({ registrationAddOns: [pendingAddOn] })],
      ),
    ).toEqual({
      'registration-1:addon-1': {
        operationKey: 'canonical-key',
        quantity: 2,
        source: 'canonical',
      },
      'registration-2:addon-2': {
        operationKey: 'ambiguous-local-key',
        quantity: 1,
        source: 'local',
      },
    });
  });

  it('clears a canonical attempt after owner state no longer reports it pending', () => {
    expect(
      reconcileRegistrationAddonPurchaseAttempts(
        {
          'registration-1:addon-1': {
            operationKey: 'expired-canonical-key',
            quantity: 1,
            source: 'canonical',
          },
          'registration-2:addon-2': {
            operationKey: 'ambiguous-local-key',
            quantity: 2,
            source: 'local',
          },
        },
        [registrationStatus()],
      ),
    ).toEqual({
      'registration-2:addon-2': {
        operationKey: 'ambiguous-local-key',
        quantity: 2,
        source: 'local',
      },
    });
  });
});

describe('active registration template source', () => {
  it('keeps pending registration payment copy explicit', () => {
    const template = readSource(
      'src/app/events/event-active-registration/event-active-registration.component.html',
    );

    expect(template).toContain(
      'registrationCheckoutUrl(registration.checkoutUrl)',
    );
    expect(template).toContain('Your payment link is not ready yet.');
    expect(template).toContain(
      'Your ticket is not confirmed until payment succeeds.',
    );
  });

  it('does not render a cancel action for transfer refund states', () => {
    const template = readSource(
      'src/app/events/event-active-registration/event-active-registration.component.html',
    );

    expect(template).toContain('transferStatus.cancelLabel');
    expect(template).toContain('registrationActiveTransferStatusCopy');
    expect(template).toContain(
      `[attr.role]="transferStatus.tone === 'error' ? 'alert' : 'status'"`,
    );
  });
});

const purchaseAddon = vi.fn();
const canOrganize = vi.fn();
const cancelRegistration = vi.fn();
const cancelTransfer = vi.fn();
const createTransfer = vi.fn();
const dialogOpen = vi.fn();

const registrationFailureCases = [
  {
    error: new EventRegistrationConflictError({
      message: 'This registration changed. Reload and try again.',
    }),
    expectedMessage: 'This registration changed. Reload and try again.',
  },
  {
    error: new EventRegistrationNotFoundError({
      message: 'This registration is no longer available.',
    }),
    expectedMessage: 'This registration is no longer available.',
  },
  {
    error: new EventRegistrationInternalError({
      message: 'Private registration infrastructure detail',
    }),
    expectedMessage: null,
  },
];

const normalizeText = (
  fixture: ComponentFixture<EventActiveRegistrationComponent>,
): string => fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

const findButton = (
  fixture: ComponentFixture<EventActiveRegistrationComponent>,
  label: string,
): HTMLButtonElement | undefined => {
  const root: HTMLElement = fixture.nativeElement;
  return [...root.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(label),
  );
};

describe('EventActiveRegistrationComponent add-on purchase', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    purchaseAddon.mockReset();
    canOrganize.mockReset();
    canOrganize.mockResolvedValue(true);
    cancelRegistration.mockReset();
    cancelRegistration.mockResolvedValue(undefined);
    cancelTransfer.mockReset();
    cancelTransfer.mockResolvedValue(undefined);
    createTransfer.mockReset();
    dialogOpen.mockReset();
    dialogOpen.mockReturnValue({ afterClosed: () => of(false) });
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: Infinity, retry: false },
      },
    });
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    vi.spyOn(queryClient, 'resetQueries');

    await TestBed.configureTestingModule({
      imports: [EventActiveRegistrationComponent],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: TENANT_DATE_PIPE_TIMEZONE,
          useValue: 'Europe/Berlin',
        },
        {
          provide: EventActiveRegistrationOperations,
          useValue: {
            cancelRegistration: () => ({
              mutationFn: cancelRegistration,
              mutationKey: ['cancel-registration'],
            }),
            cancelTransfer: () => ({
              mutationFn: cancelTransfer,
              mutationKey: ['cancel-transfer'],
            }),
            createTransfer: () => ({
              mutationFn: createTransfer,
              mutationKey: ['create-transfer'],
            }),
            eventDetailsQueryKey: (eventId: string) => [
              'event-details',
              eventId,
            ],
            eventOrganizerAccessQueryKey: (eventId: string) => [
              'event-organizer-access',
              eventId,
            ],
            eventOrganizerAccessQueryOptions: (eventId: string) => ({
              queryFn: canOrganize,
              queryKey: ['event-organizer-access', eventId],
            }),
            purchaseRegistrationAddon: () => ({
              mutationFn: purchaseAddon,
              mutationKey: ['purchase-registration-addon'],
            }),
            registrationStatusQueryKey: (eventId: string) => [
              'registration-status',
              eventId,
            ],
            scannerAccessQueryKey: () => ['scanner-access'],
            userEventsQueryKey: () => ['user-events'],
          },
        },
        { provide: MatDialog, useValue: { open: dialogOpen } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  const render = (
    registration: EventsRegistrationStatusRecord,
  ): ComponentFixture<EventActiveRegistrationComponent> => {
    const fixture = TestBed.createComponent(EventActiveRegistrationComponent);
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.componentRef.setInput('registrations', [registration]);
    fixture.detectChanges();
    return fixture;
  };

  it('shows the typed cancellation review block without changing the pending registration', async () => {
    const message =
      'Payment setup needs review. Keep the existing sign-up and contact the organizer.';
    cancelRegistration.mockRejectedValue(
      new EventRegistrationConflictError({ message }),
    );
    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });
    const registration = registrationStatus({
      paymentPending: true,
      status: 'PENDING',
    });
    const fixture = render(registration);
    findButton(fixture, 'Cancel sign-up')?.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      const root: unknown = fixture.nativeElement;
      if (!(root instanceof HTMLElement))
        throw new Error('Expected the ticket root to be an HTML element');
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(
        message,
      );
    });
    expect(registration).toMatchObject({
      paymentPending: true,
      status: 'PENDING',
    });
    expect(cancelRegistration).toHaveBeenCalledOnce();
  });

  it('reports an uncertain cancellation after the server commits but the response is lost', async () => {
    let serverCancelled = false;
    cancelRegistration.mockImplementation(async () => {
      serverCancelled = true;
      throw new Error('Connection closed before the response arrived');
    });
    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });
    const fixture = render(registrationStatus());
    findButton(fixture, 'Cancel ticket')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const element: unknown = fixture.nativeElement;
      if (!(element instanceof HTMLElement))
        throw new Error('Expected the sign-up root to be an HTML element');
      const alert = element.querySelector('[role="alert"]');
      expect(alert?.querySelector('h3')?.textContent).toBe(
        'Review cancellation',
      );
      expect(alert?.textContent).toContain(
        'The cancellation outcome could not be confirmed. Load the page again to check the current sign-up status before trying again.',
      );
      expect(alert?.textContent).not.toContain('Nothing changed');
    });
    expect(serverCancelled).toBe(true);
    expect(cancelRegistration).toHaveBeenCalledOnce();
  });

  it('requires explicit confirmation before cancelling a registration', async () => {
    const fixture = render(registrationStatus());

    findButton(fixture, 'Cancel ticket')?.click();

    await vi.waitFor(() => expect(dialogOpen).toHaveBeenCalledOnce());
    expect(cancelRegistration).not.toHaveBeenCalled();
    expect(dialogOpen.mock.calls[0]?.[1]).toMatchObject({
      data: {
        actor: 'participant',
        paymentPending: false,
        status: 'CONFIRMED',
      },
    });
  });

  it('cancels only after the confirmation dialog resolves true', async () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });
    const fixture = render(registrationStatus());

    findButton(fixture, 'Cancel ticket')?.click();

    await vi.waitFor(() => expect(cancelRegistration).toHaveBeenCalledOnce());
    expect(cancelRegistration.mock.calls[0]?.[0]).toEqual({
      expectedPaymentPending: false,
      expectedStatus: 'CONFIRMED',
      registrationId: 'registration-1',
    });
  });

  it.each(registrationFailureCases)(
    'shows only safe cancellation details for $error._tag',
    async ({ error, expectedMessage }) => {
      cancelRegistration.mockRejectedValue(error);
      dialogOpen.mockReturnValue({ afterClosed: () => of(true) });
      const fixture = render(registrationStatus());

      findButton(fixture, 'Cancel registration')?.click();

      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(cancelRegistration).toHaveBeenCalledOnce();
        expect(normalizeText(fixture)).toContain(
          expectedMessage ??
            'The sign-up could not be cancelled. Check its current status and contact an organizer for help.',
        );
        expect(normalizeText(fixture)).not.toContain('Private registration');
      });
    },
  );

  it.each([
    {
      error: new RegistrationTransferConflictError({
        message: 'This ticket already has an active transfer.',
      }),
      expectedMessage: 'This ticket already has an active transfer.',
    },
    {
      error: new RegistrationTransferNotFoundError({
        message: 'This transfer is no longer available.',
      }),
      expectedMessage: 'This transfer is no longer available.',
    },
    {
      error: new RegistrationTransferInternalError({
        message: 'Private transfer infrastructure detail',
      }),
      expectedMessage: 'Transfer failed',
    },
  ])(
    'shows only safe transfer details for $error._tag',
    async ({ error, expectedMessage }) => {
      createTransfer.mockRejectedValue(error);
      const fixture = render(registrationStatus());

      findButton(fixture, 'Create transfer link')?.click();

      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(createTransfer).toHaveBeenCalledOnce();
        expect(normalizeText(fixture)).toContain(expectedMessage);
        expect(normalizeText(fixture)).not.toContain('Private transfer');
      });
    },
  );

  it.each(registrationFailureCases)(
    'shows only safe add-on purchase details for $error._tag',
    async ({ error, expectedMessage }) => {
      purchaseAddon.mockRejectedValue(error);
      const fixture = render(registrationStatus());

      findButton(fixture, 'Add to ticket')?.click();

      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(purchaseAddon).toHaveBeenCalledOnce();
        expect(normalizeText(fixture)).toContain(
          expectedMessage ?? 'Add-on purchase failed',
        );
        expect(normalizeText(fixture)).not.toContain('Private registration');
        expect(normalizeText(fixture)).toContain(
          'Trying again will not create a duplicate purchase.',
        );
      });
    },
  );

  it('keeps independently granted organizer authority after organizer/helper cancellation', async () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });
    canOrganize.mockResolvedValue(true);
    queryClient.setQueryData(['event-organizer-access', 'event-1'], true);
    const fixture = render(
      registrationStatus({ organizingRegistration: true }),
    );

    findButton(fixture, 'Cancel ticket')?.click();

    await vi.waitFor(() => {
      expect(cancelRegistration).toHaveBeenCalledOnce();
      expect(canOrganize).toHaveBeenCalledOnce();
      expect(
        queryClient.getQueryData(['event-organizer-access', 'event-1']),
      ).toBe(true);
    });
  });

  it('removes event-scoped organizer authority when the cancelled registration was its source', async () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });
    canOrganize.mockResolvedValue(false);
    queryClient.setQueryData(['event-organizer-access', 'event-1'], true);
    const fixture = render(
      registrationStatus({ organizingRegistration: true }),
    );

    findButton(fixture, 'Cancel ticket')?.click();

    await vi.waitFor(() => {
      expect(cancelRegistration).toHaveBeenCalledOnce();
      expect(canOrganize).toHaveBeenCalledOnce();
      expect(
        queryClient.getQueryData(['event-organizer-access', 'event-1']),
      ).toBe(false);
    });
  });

  it('fails organizer authority closed to unknown when its authoritative refresh fails', async () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });
    canOrganize.mockRejectedValue(new Error('Authority unavailable'));
    queryClient.setQueryData(['event-organizer-access', 'event-1'], true);
    const fixture = render(
      registrationStatus({ organizingRegistration: true }),
    );

    findButton(fixture, 'Cancel ticket')?.click();

    await vi.waitFor(() => {
      expect(cancelRegistration).toHaveBeenCalledOnce();
      expect(canOrganize).toHaveBeenCalledOnce();
      expect(
        queryClient.getQueryData(['event-organizer-access', 'event-1']),
      ).toBeUndefined();
    });
  });

  it('renders the server-derived deadline explanation and guards cancellation', async () => {
    const registration = registrationStatus({
      cancellationAvailable: false,
      cancellationBlockedReason: 'deadlinePassed',
    });
    const fixture = render(registration);

    expect(normalizeText(fixture)).toContain(
      'The cancellation deadline has passed. Your ticket is still active, no place has been released, and no refund has started.',
    );
    expect(findButton(fixture, 'Cancel ticket')).toBeUndefined();

    await fixture.componentInstance.cancelRegistration(registration);

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(cancelRegistration).not.toHaveBeenCalled();
  });

  it('binds delayed confirmation to the state the participant reviewed', async () => {
    const dialogResult = new Subject<boolean>();
    dialogOpen.mockReturnValue({ afterClosed: () => dialogResult });
    const pendingApplication = registrationStatus({
      paymentPending: false,
      status: 'PENDING',
    });
    const fixture = render(pendingApplication);

    findButton(fixture, 'Withdraw application')?.click();
    await vi.waitFor(() => expect(dialogOpen).toHaveBeenCalledOnce());
    fixture.componentRef.setInput('registrations', [
      registrationStatus({ paymentPending: false, status: 'CONFIRMED' }),
    ]);
    fixture.detectChanges();
    dialogResult.next(true);
    dialogResult.complete();

    await vi.waitFor(() => expect(cancelRegistration).toHaveBeenCalledOnce());
    expect(cancelRegistration.mock.calls[0]?.[0]).toEqual({
      expectedPaymentPending: false,
      expectedStatus: 'PENDING',
      registrationId: 'registration-1',
    });
  });

  it('adds a free add-on, announces completion, and invalidates owner queries', async () => {
    purchaseAddon.mockResolvedValue({
      orderId: 'order-1',
      status: 'completed',
    });
    const fixture = render(registrationStatus());
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('input')?.getAttribute('aria-label')).toBe(
      'Quantity for Welcome dinner',
    );

    findButton(fixture, 'Add to ticket')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(purchaseAddon).toHaveBeenCalledOnce();
      expect(normalizeText(fixture)).toContain(
        '1 × Welcome dinner added to your ticket.',
      );
    });
    expect(purchaseAddon.mock.calls[0]?.[0]).toMatchObject({
      addOnId: 'addon-1',
      operationKey: expect.any(String),
      quantity: 1,
      registrationId: 'registration-1',
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      { exact: true, queryKey: ['registration-status', 'event-1'] },
      { throwOnError: true },
    );
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      { exact: true, queryKey: ['event-details', 'event-1'] },
      { throwOnError: true },
    );
    expect(queryClient.resetQueries).toHaveBeenCalledWith(
      { exact: true, queryKey: ['event-organizer-access', 'event-1'] },
      { throwOnError: true },
    );
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      { exact: true, queryKey: ['scanner-access'] },
      { throwOnError: true },
    );
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      { exact: true, queryKey: ['user-events'] },
      { throwOnError: true },
    );
  });

  it('reuses the operation key after a committed free purchase response is lost', async () => {
    purchaseAddon
      .mockRejectedValueOnce(new Error('Checkout unavailable'))
      .mockResolvedValueOnce({ orderId: 'order-1', status: 'completed' });
    const fixture = render(registrationStatus());
    queryClient.setQueryData(['registration-status', 'event-1'], {
      isRegistered: true,
      registrations: [registrationStatus()],
    });
    vi.mocked(queryClient.invalidateQueries).mockImplementation(
      async (filters) => {
        if (filters?.queryKey?.[0] === 'registration-status') {
          queryClient.setQueryData(['registration-status', 'event-1'], {
            isRegistered: true,
            registrations: [
              registrationStatus({
                registrationAddOns: [
                  registrationAddon({
                    maxPurchasableQuantity: 2,
                    remainingQuantity: 1,
                    settledPurchasedQuantity: 1,
                    totalQuantity: 1,
                  }),
                ],
              }),
            ],
          });
        }
      },
    );

    findButton(fixture, 'Add to ticket')?.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Add-on purchase failed');
      expect(normalizeText(fixture)).not.toContain('Checkout unavailable');
      expect(normalizeText(fixture)).toContain(
        'Trying again will not create a duplicate purchase.',
      );
      expect(normalizeText(fixture)).toContain(
        'If the payment page has expired, start the add-on purchase again.',
      );
    });
    findButton(fixture, 'Add to ticket')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(purchaseAddon).toHaveBeenCalledTimes(2);
      expect(normalizeText(fixture)).toContain('added to your ticket');
    });
    expect(purchaseAddon.mock.calls[1]?.[0]).toMatchObject({
      operationKey: purchaseAddon.mock.calls[0]?.[0].operationKey,
      quantity: 1,
    });
  });

  it('locks quantity, cancellation, and transfer while an add-on write is pending', async () => {
    purchaseAddon.mockReturnValue(
      new Promise(() => {
        // Keep the write pending for the duration of this interaction test.
      }),
    );
    const fixture = render(registrationStatus());
    const root: HTMLElement = fixture.nativeElement;

    findButton(fixture, 'Add to ticket')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.querySelector('input')?.hasAttribute('disabled')).toBe(true);
      expect(findButton(fixture, 'Cancel ticket')?.disabled).toBe(true);
      expect(findButton(fixture, 'Create transfer link')?.disabled).toBe(true);
    });
  });

  it('keeps a canonical add-on claim without a payment link visible without offering another creation attempt', () => {
    const pendingAddOn = registrationAddon({
      isPaid: true,
      maxPurchasableQuantity: 0,
      pendingCheckoutExpiresAt: '2030-05-01T12:00:00.000Z',
      pendingCheckoutUrl: null,
      pendingOperationKey: 'canonical-unbound-key',
      pendingQuantity: 2,
      purchaseAvailable: false,
      purchaseBlockedReason: 'paymentPending',
      purchaseStatus: 'paymentPending',
    });
    const unchangedClaim = structuredClone(pendingAddOn);
    const fixture = render(
      registrationStatus({
        registrationAddOns: [pendingAddOn],
        transferAvailable: false,
        transferBlockedReason: 'addonPaymentPending',
      }),
    );
    const element: HTMLElement = fixture.nativeElement;

    expect(normalizeText(fixture)).toContain(
      'Payment is pending for 2 × Welcome dinner.',
    );
    expect(normalizeText(fixture)).toContain(
      'This add-on payment needs review.',
    );
    expect(normalizeText(fixture)).toContain(
      'Keep this pending purchase and contact an organizer before trying to buy them again.',
    );
    expect(normalizeText(fixture)).not.toContain('is still being prepared');
    expect(normalizeText(fixture)).not.toContain('Continue the same');
    expect(normalizeText(fixture)).toContain(
      'If no payment link is available, contact an organizer to review it.',
    );
    expect(findButton(fixture, 'Try again')).toBeUndefined();
    expect(
      element.querySelector('a[href^="https://checkout.stripe.com"]'),
    ).toBeNull();
    expect(purchaseAddon).not.toHaveBeenCalled();
    expect(pendingAddOn).toEqual(unchangedClaim);
  });

  it('keeps a pending registration with no payment link visible for organizer review', () => {
    const registration = registrationStatus({
      checkoutUrl: null,
      paymentPending: true,
      registrationAddOns: [],
      status: 'PENDING',
    });
    const unchangedRegistration = structuredClone(registration);
    const fixture = render(registration);
    expect(normalizeText(fixture)).toContain(
      'Contact an organizer to review this payment. Keep this sign-up and do not start another payment.',
    );
    expect(findButton(fixture, 'Try payment again')).toBeUndefined();
    expect(purchaseAddon).not.toHaveBeenCalled();
    expect(cancelRegistration).not.toHaveBeenCalled();
    expect(registration).toEqual(unchangedRegistration);
  });

  it('does not open a pending add-on payment link after its deadline', () => {
    const pendingAddOn = registrationAddon({
      isPaid: true,
      maxPurchasableQuantity: 0,
      pendingCheckoutExpired: true,
      pendingCheckoutExpiresAt: '2030-05-01T12:00:00.000Z',
      pendingCheckoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_expired',
      pendingOperationKey: 'expired-operation',
      pendingQuantity: 2,
      purchaseAvailable: false,
      purchaseBlockedReason: 'paymentPending',
      purchaseStatus: 'paymentPending',
    });
    const fixture = render(
      registrationStatus({ registrationAddOns: [pendingAddOn] }),
    );
    const element: HTMLElement = fixture.nativeElement;
    expect(normalizeText(fixture)).toContain('The payment window has ended');
    expect(normalizeText(fixture)).toContain(
      'These items are not on your ticket. Contact an organizer before trying to buy them again.',
    );
    expect(
      element.querySelector('a[href^="https://checkout.stripe.com"]'),
    ).toBeNull();
    expect(findButton(fixture, 'Try again')).toBeUndefined();
    expect(purchaseAddon).not.toHaveBeenCalled();
  });

  it('shows canonical pending checkout without a stale local error or duplicate link', async () => {
    purchaseAddon.mockRejectedValueOnce(new Error('Response was lost'));
    const availablePaidAddOn = registrationAddon({
      isPaid: true,
      nextPurchaseTaxRateDisplayName: 'VAT',
      nextPurchaseTaxRateInclusive: false,
      nextPurchaseTaxRatePercentage: '19',
      nextPurchaseUnitGrossAmount: 1190,
      nextPurchaseUnitPrice: 1000,
      nextPurchaseUnitTaxAmount: 190,
    });
    const fixture = render(
      registrationStatus({ registrationAddOns: [availablePaidAddOn] }),
    );

    findButton(fixture, 'Continue to payment')?.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Add-on purchase failed');
      expect(normalizeText(fixture)).not.toContain('Response was lost');
    });

    fixture.componentRef.setInput('registrations', [
      registrationStatus({
        registrationAddOns: [
          registrationAddon({
            ...availablePaidAddOn,
            maxPurchasableQuantity: 0,
            pendingCheckoutExpiresAt: '2030-05-01T12:00:00.000Z',
            pendingCheckoutUrl:
              'https://checkout.stripe.com/c/pay/cs_test_pending',
            pendingOperationKey: 'canonical-key',
            pendingQuantity: 1,
            purchaseAvailable: false,
            purchaseBlockedReason: 'paymentPending',
            purchaseStatus: 'paymentPending',
          }),
        ],
        transferAvailable: false,
        transferBlockedReason: 'addonPaymentPending',
      }),
    ]);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;

    expect(normalizeText(fixture)).not.toContain('Add-on purchase failed');
    expect(normalizeText(fixture)).not.toContain('Response was lost');
    expect(
      root.querySelectorAll('a[href^="https://checkout.stripe.com"]'),
    ).toHaveLength(1);
  });

  it('clears canonical retry state when parent owner data settles independently', async () => {
    purchaseAddon.mockResolvedValue({
      orderId: 'order-2',
      status: 'completed',
    });
    const fixture = render(
      registrationStatus({
        registrationAddOns: [
          registrationAddon({
            maxPurchasableQuantity: 0,
            pendingCheckoutExpiresAt: '2030-05-01T12:00:00.000Z',
            pendingCheckoutUrl:
              'https://checkout.stripe.com/c/pay/cs_test_previous',
            pendingOperationKey: 'canonical-key',
            pendingQuantity: 1,
            purchaseAvailable: false,
            purchaseBlockedReason: 'paymentPending',
            purchaseStatus: 'paymentPending',
          }),
        ],
        transferAvailable: false,
        transferBlockedReason: 'addonPaymentPending',
      }),
    );

    fixture.componentRef.setInput('registrations', [registrationStatus()]);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('a[href*="cs_test_previous"]')).toBeNull();

    findButton(fixture, 'Add to ticket')?.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(purchaseAddon).toHaveBeenCalledOnce();
    });
    expect(purchaseAddon.mock.calls[0]?.[0].operationKey).not.toBe(
      'canonical-key',
    );
  });

  it('renders only an exact safe pending Stripe URL and disables conflicting actions', () => {
    const pendingAddOn = registrationAddon({
      isPaid: true,
      maxPurchasableQuantity: 0,
      nextPurchaseTaxRateDisplayName: 'VAT',
      nextPurchaseTaxRateInclusive: false,
      nextPurchaseTaxRatePercentage: '19',
      nextPurchaseUnitGrossAmount: 1190,
      nextPurchaseUnitPrice: 1000,
      nextPurchaseUnitTaxAmount: 190,
      pendingCheckoutExpiresAt: '2030-05-01T12:00:00.000Z',
      pendingCheckoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_pending',
      pendingOperationKey: 'canonical-key',
      pendingQuantity: 2,
      purchaseAvailable: false,
      purchaseBlockedReason: 'paymentPending',
      purchaseStatus: 'paymentPending',
    });
    const fixture = render(
      registrationStatus({
        registrationAddOns: [pendingAddOn],
        transferAvailable: false,
        transferBlockedReason: 'addonPaymentPending',
      }),
    );
    const root: HTMLElement = fixture.nativeElement;
    const checkoutLink = root.querySelector<HTMLAnchorElement>(
      'a[href^="https://checkout.stripe.com"]',
    );

    expect(normalizeText(fixture)).toContain(
      'before transferring this ticket.',
    );
    expect(normalizeText(fixture)).toContain(
      'wait for that payment page to expire',
    );
    expect(normalizeText(fixture)).not.toContain(
      'This add-on payment needs review.',
    );
    expect(checkoutLink?.href).toBe(
      'https://checkout.stripe.com/c/pay/cs_test_pending',
    );
    expect(normalizeText(fixture)).toContain(
      'Your ticket updates only after the online payment is confirmed.',
    );
    expect(findButton(fixture, 'Cancel ticket')?.disabled).toBe(true);
    expect(findButton(fixture, 'Transfer unavailable')?.disabled).toBe(true);
  });

  it('fails closed when the persisted pending checkout URL is unsafe', () => {
    const fixture = render(
      registrationStatus({
        registrationAddOns: [
          registrationAddon({
            maxPurchasableQuantity: 0,
            pendingCheckoutUrl:
              'https://checkout.stripe.com.evil.example/c/pay/cs_test',
            pendingOperationKey: 'canonical-key',
            pendingQuantity: 1,
            purchaseAvailable: false,
            purchaseBlockedReason: 'paymentPending',
            purchaseStatus: 'paymentPending',
          }),
        ],
      }),
    );
    const root: HTMLElement = fixture.nativeElement;
    const alert = root.querySelector('[role="alert"]');

    expect(alert?.textContent).toContain('invalid payment link');
    expect(alert?.closest('[role="status"]')).toBeNull();
    expect(
      root.querySelector('a[href*="checkout.stripe.com.evil"]'),
    ).toBeNull();
  });

  it('distinguishes an invalid registration checkout URL from an unbound payment claim', () => {
    const fixture = render(
      registrationStatus({
        checkoutUrl: 'https://checkout.stripe.com.evil.example/c/pay/cs_test',
        paymentPending: true,
        registrationAddOns: [],
        status: 'PENDING',
        transferAvailable: false,
        transferBlockedReason: 'registrationStatus',
      }),
    );
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'invalid payment link',
    );
    expect(normalizeText(fixture)).not.toContain(
      'Contact an organizer to review this payment.',
    );
    expect(
      root.querySelector('a[href*="checkout.stripe.com.evil"]'),
    ).toBeNull();
  });
});

describe('registration transfer offer dialog source', () => {
  it('keeps private credentials and ownership transition copy explicit', () => {
    const template = readSource(
      'src/app/events/event-active-registration/event-registration-transfer-dialog.component.html',
    );
    const normalizedTemplate = template.replaceAll(/\s+/gu, ' ');

    expect(normalizedTemplate).toContain('Claim link');
    expect(normalizedTemplate).toContain('Manual claim code');
    expect(normalizedTemplate).toContain(
      'Send either the link or code to one person you trust.',
    );
    expect(normalizedTemplate).toContain('Keep both private.');
    expect(normalizedTemplate).toContain(
      'stays active until the recipient is confirmed.',
    );
  });
});
