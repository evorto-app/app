import '@angular/compiler';
import type {
  EventsRegistrationAddonRecord,
  EventsRegistrationStatusRecord,
} from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  checkoutUrl: null,
  discountAmount: 0,
  guestCount: 0,
  id: 'registration-1',
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
  it('describes pending payment cancellation as releasing reserved spots', () => {
    expect(
      registrationCancellationCopy({
        activeTransfer: null,
        guestCount: 2,
        paymentPending: true,
        status: 'PENDING',
      }),
    ).toEqual({
      buttonLabel: 'Cancel registration',
      helperText:
        'This cancels the pending registration and releases all selected spots. It does not complete a payment.',
    });
  });

  it('describes confirmed cancellation and refund fallback handling', () => {
    expect(
      registrationCancellationCopy({
        activeTransfer: null,
        guestCount: 0,
        paymentPending: false,
        status: 'CONFIRMED',
      }),
    ).toEqual({
      buttonLabel: 'Cancel registration',
      helperText:
        'This cancels your confirmed registration and releases your spot. If this was paid, Evorto submits a Stripe refund when the original payment reference is available; otherwise it creates a pending manual refund record for organizers.',
    });
  });

  it('does not expose generic cancellation for recipient transfer checkout', () => {
    const registration = {
      activeTransfer: {
        expiresAt: '2030-05-01T12:00:00.000Z',
        registrationSide: 'recipient' as const,
        status: 'checkout_pending' as const,
        transferId: 'transfer-1',
      },
      guestCount: 1,
      paymentPending: true,
      status: 'PENDING' as const,
    };

    expect(recipientTransferCheckoutPending(registration)).toBe(true);
    expect(registrationCancellationCopy(registration)).toBeNull();
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

  it('explains each add-on and payment-specific transfer block', () => {
    expect(registrationTransferBlockedCopy('addonPaymentPending')).toContain(
      'pending add-on checkout',
    );
    expect(registrationTransferBlockedCopy('addonFulfillmentState')).toContain(
      'Redeemed or cancelled add-ons',
    );
    expect(
      registrationTransferBlockedCopy('unsupportedPaymentMethod'),
    ).toContain('does not support automated transfer refunds');
    expect(registrationTransferBlockedCopy('paidAddon')).toContain(
      'paid add-on',
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
        'Finish or let the pending add-on checkout expire before transferring this ticket.',
    });
  });

  it('does not offer transfer cancellation during refund reconciliation', () => {
    const refundPending = registrationActiveTransferStatusCopy({
      expiresAt: '2030-05-01T12:00:00.000Z',
      registrationSide: 'source',
      status: 'refund_pending',
      transferId: 'transfer-1',
    });
    const refundFailed = registrationActiveTransferStatusCopy({
      expiresAt: '2030-05-01T12:00:00.000Z',
      registrationSide: 'recipient',
      status: 'refund_failed',
      transferId: 'transfer-1',
    });

    expect(refundPending).toMatchObject({
      cancelLabel: null,
      showExpiry: false,
      title: 'Transfer refund is processing',
    });
    expect(refundFailed).toMatchObject({
      cancelLabel: null,
      showExpiry: false,
      title: 'Transfer refund needs attention',
    });
    expect(refundFailed.body).toContain('Your ticket remains confirmed');
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
    ['registrationStatus', 'confirmed registration'],
    ['eventUnavailable', 'not available'],
    ['activeTransfer', 'active transfer'],
    ['paymentPending', 'already in progress'],
    ['beforeEventDisabled', 'not sold before'],
    ['duringEventDisabled', 'not sold during'],
    ['eventEnded', 'event has ended'],
    ['multipleNotAllowed', 'only once'],
    ['optionLimitReached', 'registration option'],
    ['userLimitReached', 'per-person limit'],
    ['outOfStock', 'sold out'],
    ['paymentUnavailable', 'Online payment'],
    ['taxUnavailable', 'tax setup'],
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
    expect(template).toContain('Your payment link is being prepared.');
    expect(template).toContain(
      'Your registration is not confirmed until payment succeeds.',
    );
  });

  it('does not render a cancel action for transfer refund states', () => {
    const template = readSource(
      'src/app/events/event-active-registration/event-active-registration.component.html',
    );

    expect(template).toContain('transferStatus.cancelLabel');
    expect(template).toContain('registrationActiveTransferStatusCopy');
  });
});

const purchaseAddon = vi.fn();
const cancelRegistration = vi.fn();
const cancelTransfer = vi.fn();
const createTransfer = vi.fn();

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
    cancelRegistration.mockReset();
    cancelRegistration.mockResolvedValue(undefined);
    cancelTransfer.mockReset();
    cancelTransfer.mockResolvedValue(undefined);
    createTransfer.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    await TestBed.configureTestingModule({
      imports: [EventActiveRegistrationComponent],
      providers: [
        provideTanStackQuery(queryClient),
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
            purchaseRegistrationAddon: () => ({
              mutationFn: purchaseAddon,
              mutationKey: ['purchase-registration-addon'],
            }),
            registrationStatusQueryKey: (eventId: string) => [
              'registration-status',
              eventId,
            ],
            userEventsQueryKey: () => ['user-events'],
          },
        },
        { provide: MatDialog, useValue: { open: vi.fn() } },
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
      expect(normalizeText(fixture)).toContain('Checkout unavailable');
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
      expect(findButton(fixture, 'Cancel registration')?.disabled).toBe(true);
      expect(findButton(fixture, 'Create transfer link')?.disabled).toBe(true);
    });
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

    findButton(fixture, 'Continue to Stripe')?.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Response was lost');
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

    expect(checkoutLink?.href).toBe(
      'https://checkout.stripe.com/c/pay/cs_test_pending',
    );
    expect(normalizeText(fixture)).toContain(
      'Your ticket updates only after Stripe confirms payment.',
    );
    expect(findButton(fixture, 'Cancel registration')?.disabled).toBe(true);
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

  it('distinguishes an invalid registration checkout URL from a link still being prepared', () => {
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
      'invalid registration payment link',
    );
    expect(normalizeText(fixture)).not.toContain(
      'Your payment link is being prepared.',
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

    expect(template).toContain('Claim link');
    expect(template).toContain('Manual claim code');
    expect(template).toContain('do not post these credentials');
    expect(template).toContain(
      'stays active until the recipient is confirmed.',
    );
  });
});
