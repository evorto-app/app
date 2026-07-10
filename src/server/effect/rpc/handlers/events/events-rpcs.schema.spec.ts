import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  EventGraphAddonInput,
  EventGraphEditRecord,
  EventGraphRegistrationOptionInput,
  EventReviewStatus,
  EventsApproveRegistrationResult,
  EventsCreateRegistrationOptionInput,
  EventsFindOneAddon,
  EventsFindOneRegistrationOption,
  EventsGetOrganizeOverviewUser,
  EventsJoinWaitlistPayload,
  EventsPurchaseRegistrationAddonPayload,
  EventsPurchaseRegistrationAddonResult,
  EventsRegisterForEventPayload,
  EventsRegistrationAddonRecord,
  EventsRegistrationStatus,
  EventsRegistrationStatusRecord,
} from '../../../../../shared/rpc-contracts/app-rpcs/events.rpcs';
import { EventLocation } from '../../../../../types/location';

describe('events RPC location schema', () => {
  it('accepts a structured Google event location', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventLocation)({
        address: 'Example Street 1',
        coordinates: {
          lat: 52.37,
          lng: 4.9,
        },
        name: 'Example Place',
        placeId: 'place-1',
        type: 'google',
      }),
    ).not.toThrow();
  });

  it('rejects malformed physical event locations', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventLocation)({
        name: 'Broken Place',
        placeId: 'place-1',
        type: 'google',
      }),
    ).toThrow();
  });
});

describe('events RPC registration status schema', () => {
  it('accepts every persisted registration status', () => {
    for (const status of ['CANCELLED', 'CONFIRMED', 'PENDING', 'WAITLIST']) {
      expect(() =>
        Schema.decodeUnknownSync(EventsRegistrationStatus)(status),
      ).not.toThrow();
    }
  });

  it('rejects unknown active registration statuses', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventsRegistrationStatusRecord)({
        activeTransfer: null,
        addonPurchases: [],
        guestCount: 0,
        id: 'registration-1',
        paymentPending: false,
        registrationAddOns: [],
        registrationOptionId: 'option-1',
        registrationOptionTitle: 'Participant',
        status: 'UNKNOWN',
        transferAvailable: false,
        transferBlockedReason: 'registrationStatus',
      }),
    ).toThrow();
  });

  it('carries purchased add-ons on active registration records', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventsRegistrationStatusRecord)({
        activeTransfer: null,
        addonPurchases: [
          {
            quantity: 2,
            title: 'Workshop kit',
            unitPrice: 500,
          },
        ],
        guestCount: 0,
        id: 'registration-1',
        paymentPending: false,
        registrationAddOns: [],
        registrationOptionId: 'option-1',
        registrationOptionTitle: 'Participant',
        status: 'CONFIRMED',
        transferAvailable: false,
        transferBlockedReason: 'paidAddon',
      }),
    ).not.toThrow();
  });

  it('represents transfer blockers enforced by the offer flow', () => {
    for (const transferBlockedReason of [
      'addonFulfillmentState',
      'unsupportedPaymentMethod',
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(EventsRegistrationStatusRecord)({
          activeTransfer: null,
          addonPurchases: [],
          guestCount: 0,
          id: 'registration-1',
          paymentPending: false,
          registrationAddOns: [],
          registrationOptionId: 'option-1',
          registrationOptionTitle: 'Participant',
          status: 'CONFIRMED',
          transferAvailable: false,
          transferBlockedReason,
        }),
      ).not.toThrow();
    }
  });

  it('represents every active transfer state in the owner registration response', () => {
    for (const status of [
      'checkout_pending',
      'open',
      'refund_pending',
      'refund_failed',
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(EventsRegistrationStatusRecord)({
          activeTransfer: {
            expiresAt: '2026-08-01T17:00:00.000Z',
            registrationSide: 'source',
            status,
            transferId: 'transfer-1',
          },
          addonPurchases: [],
          guestCount: 0,
          id: 'registration-1',
          paymentPending: false,
          registrationAddOns: [],
          registrationOptionId: 'option-1',
          registrationOptionTitle: 'Participant',
          status: 'CONFIRMED',
          transferAvailable: false,
          transferBlockedReason: 'activeTransfer',
        }),
      ).not.toThrow();
    }
  });

  it('carries comprehensive participant add-on state without Stripe identifiers', () => {
    const record = Schema.decodeUnknownSync(EventsRegistrationAddonRecord)({
      addOnId: 'addon-1',
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: false,
      cancelledQuantity: 1,
      currency: 'EUR',
      currentPurchaseWindow: 'beforeEvent',
      description: 'Workshop materials',
      includedQuantity: 1,
      isPaid: true,
      maxPurchasableQuantity: 1,
      maxQuantityPerUser: 4,
      nextPurchaseTaxRateDisplayName: 'VAT',
      nextPurchaseTaxRateInclusive: false,
      nextPurchaseTaxRatePercentage: '19',
      nextPurchaseUnitGrossAmount: 595,
      nextPurchaseUnitPrice: 500,
      nextPurchaseUnitTaxAmount: 95,
      optionalPurchaseQuantity: 3,
      pendingCheckoutExpiresAt: '2026-08-01T17:00:00.000Z',
      pendingCheckoutUrl: null,
      pendingOperationKey: 'purchase-addon-1',
      pendingQuantity: 1,
      purchaseAvailable: false,
      purchaseBlockedReason: 'paymentPending',
      purchaseStatus: 'paymentPending',
      redeemedQuantity: 1,
      remainingQuantity: 1,
      settledPurchasedQuantity: 1,
      title: 'Workshop kit',
      totalAvailableQuantity: 8,
      totalQuantity: 2,
    });

    expect(record).not.toHaveProperty('stripeAccountId');
    expect(record).not.toHaveProperty('stripeTaxRateId');
    expect(record.pendingOperationKey).toBe('purchase-addon-1');
  });

  it('limits purchase input to participant intent and distinguishes result variants', () => {
    expect(
      Schema.decodeUnknownSync(EventsPurchaseRegistrationAddonPayload)({
        addOnId: 'addon-1',
        operationKey: 'purchase-addon-1',
        pinnedNowIso: '2026-08-01T12:00:00.000Z',
        price: 1,
        quantity: 2,
        registrationId: 'registration-1',
        stripeAccountId: 'acct_secret',
        tenantId: 'tenant-other',
        userId: 'user-other',
      }),
    ).toEqual({
      addOnId: 'addon-1',
      operationKey: 'purchase-addon-1',
      quantity: 2,
      registrationId: 'registration-1',
    });
    expect(() =>
      Schema.decodeUnknownSync(EventsPurchaseRegistrationAddonResult)({
        orderId: 'order-1',
        status: 'completed',
      }),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventsPurchaseRegistrationAddonResult)({
        checkoutUrl: 'https://checkout.stripe.com/session',
        expiresAt: '2026-08-01T17:00:00.000Z',
        orderId: 'order-2',
        status: 'checkoutRequired',
      }),
    ).not.toThrow();
  });

  it('carries purchased add-ons on organizer registration rows', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventsGetOrganizeOverviewUser)({
        addonPurchases: [
          {
            quantity: 1,
            title: 'Dinner',
            unitPrice: 1500,
          },
        ],
        appliedDiscountedPrice: null,
        appliedDiscountType: null,
        basePriceAtRegistration: null,
        checkedIn: false,
        checkInTime: null,
        discountAmount: null,
        email: 'participant@example.com',
        firstName: 'Parti',
        lastName: 'Cipant',
        manualApprovalAvailable: false,
        paymentPending: false,
        paymentSetupRequired: false,
        registrationId: 'registration-1',
        status: 'CONFIRMED',
        transferAvailable: true,
        userId: 'user-1',
      }),
    ).not.toThrow();
  });
});

describe('events RPC approval result schema', () => {
  it('accepts confirmed and payment-pending approval outcomes', () => {
    for (const status of ['confirmed', 'paymentPending']) {
      expect(() =>
        Schema.decodeUnknownSync(EventsApproveRegistrationResult)({ status }),
      ).not.toThrow();
    }
  });

  it('rejects approval outcomes outside the public contract', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventsApproveRegistrationResult)({
        status: 'pending',
      }),
    ).toThrow();
  });
});

describe('events RPC review lifecycle schema', () => {
  it('exposes only draft, pending-review, and published persistence states', () => {
    for (const status of ['APPROVED', 'DRAFT', 'PENDING_REVIEW']) {
      expect(() =>
        Schema.decodeUnknownSync(EventReviewStatus)(status),
      ).not.toThrow();
    }

    expect(() =>
      Schema.decodeUnknownSync(EventReviewStatus)('REJECTED'),
    ).toThrow();
  });
});

describe('events RPC registration option schema', () => {
  const writableRegistrationOption = {
    closeRegistrationTime: '2026-09-20T12:00:00.000Z',
    description: null,
    isPaid: false,
    openRegistrationTime: '2026-09-10T12:00:00.000Z',
    organizingRegistration: false,
    price: 0,
    registeredDescription: null,
    registrationMode: 'fcfs',
    roleIds: [],
    spots: 10,
    stripeTaxRateId: null,
    title: 'Participant',
  };

  it('defaults event option policy overrides to tenant inheritance', () => {
    expect(
      Schema.decodeUnknownSync(EventsCreateRegistrationOptionInput)(
        writableRegistrationOption,
      ),
    ).toMatchObject({
      cancellationDeadlineHoursBeforeStart: null,
      refundFeesOnCancellation: null,
      transferDeadlineHoursBeforeStart: null,
    });
  });

  it('accepts nonnegative event option overrides and rejects negative deadlines', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventsCreateRegistrationOptionInput)({
        ...writableRegistrationOption,
        cancellationDeadlineHoursBeforeStart: 96,
        refundFeesOnCancellation: false,
        transferDeadlineHoursBeforeStart: 12,
      }),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventsCreateRegistrationOptionInput)({
        ...writableRegistrationOption,
        transferDeadlineHoursBeforeStart: -1,
      }),
    ).toThrow();
  });

  it('carries inclusive tax-rate label details for paid event cards', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventsFindOneRegistrationOption)({
        appliedDiscountType: null,
        checkedInSpots: 0,
        closeRegistrationTime: '2026-09-20T12:00:00.000Z',
        confirmedSpots: 0,
        description: null,
        discountApplied: false,
        effectivePrice: 2500,
        esnCardDiscountedPrice: null,
        eventId: 'event-1',
        id: 'option-1',
        isPaid: true,
        openRegistrationTime: '2026-09-10T12:00:00.000Z',
        organizingRegistration: false,
        price: 2500,
        questions: [
          {
            description: 'Tell us about your experience.',
            id: 'question-1',
            required: true,
            sortOrder: 0,
            title: 'Experience',
          },
        ],
        registeredDescription: null,
        registrationMode: 'fcfs',
        reservedSpots: 0,
        roleIds: ['role-1'],
        spots: 10,
        stripeTaxRateId: 'txr_vat_19',
        taxRateDisplayName: 'VAT',
        taxRatePercentage: '19',
        title: 'Participant',
      }),
    ).not.toThrow();
  });
});

describe('events RPC add-on schema', () => {
  it('carries copied event add-ons with registration option attachments', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventsFindOneAddon)({
        allowMultiple: true,
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: false,
        allowPurchaseDuringRegistration: true,
        description: 'Includes equipment rental.',
        id: 'addon-1',
        isPaid: true,
        maxQuantityPerUser: 2,
        price: 1500,
        registrationOptions: [
          {
            includedQuantity: 1,
            optionalPurchaseQuantity: 1,
            registrationOptionId: 'option-1',
          },
        ],
        stripeTaxRateId: 'txr_vat_19',
        taxRateDisplayName: 'VAT',
        taxRatePercentage: '19',
        title: 'Equipment rental',
        totalAvailableQuantity: 20,
      }),
    ).not.toThrow();
  });
});

describe('events RPC editable graph schema', () => {
  const writableOption = {
    cancellationDeadlineHoursBeforeStart: null,
    closeRegistrationTime: '2026-09-20T12:00:00.000Z',
    description: null,
    esnCardDiscountedPrice: null,
    id: 'option-1',
    isPaid: false,
    key: 'option-1',
    openRegistrationTime: '2026-09-10T12:00:00.000Z',
    organizingRegistration: false,
    price: 0,
    refundFeesOnCancellation: null,
    registeredDescription: null,
    registrationMode: 'fcfs',
    roleIds: ['role-1'],
    spots: 10,
    stripeTaxRateId: null,
    title: 'Participant',
    transferDeadlineHoursBeforeStart: null,
  };

  it('accepts event-owned mode and the complete editable graph', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventGraphEditRecord)({
        addOns: [
          {
            allowMultiple: true,
            allowPurchaseBeforeEvent: true,
            allowPurchaseDuringEvent: false,
            allowPurchaseDuringRegistration: true,
            description: null,
            id: 'addon-1',
            isPaid: false,
            maxQuantityPerUser: 2,
            price: 0,
            registrationOptions: [
              {
                includedQuantity: 1,
                optionalPurchaseQuantity: 1,
                registrationOptionId: 'option-1',
              },
            ],
            stripeTaxRateId: null,
            title: 'Equipment',
            totalAvailableQuantity: 20,
          },
        ],
        description: '<p>Event description</p>',
        end: '2026-09-20T14:00:00.000Z',
        icon: { iconColor: 0, iconName: 'calendar:fas' },
        id: 'event-1',
        location: null,
        questions: [
          {
            description: null,
            id: 'question-1',
            registrationOptionId: 'option-1',
            required: false,
            sortOrder: 0,
            title: 'Dietary requirements',
          },
        ],
        registrationOptions: [
          {
            ...writableOption,
            registrationMode: 'random',
          },
        ],
        simpleModeEnabled: false,
        start: '2026-09-20T12:00:00.000Z',
        title: 'Event',
      }),
    ).not.toThrow();
  });

  it('keeps legacy random readable but rejects it in graph writes', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventGraphRegistrationOptionInput)({
        ...writableOption,
        registrationMode: 'random',
      }),
    ).toThrow();
  });

  it('accepts distinct included and optional quantities per option mapping', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventGraphAddonInput)({
        allowMultiple: true,
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: true,
        allowPurchaseDuringRegistration: true,
        description: null,
        isPaid: false,
        key: 'addon-1',
        maxQuantityPerUser: 3,
        price: 0,
        registrationOptions: [
          {
            includedQuantity: 2,
            optionalPurchaseQuantity: 1,
            registrationOptionKey: 'option-1',
          },
          {
            includedQuantity: 0,
            optionalPurchaseQuantity: 3,
            registrationOptionKey: 'option-2',
          },
        ],
        stripeTaxRateId: null,
        title: 'Equipment',
        totalAvailableQuantity: 30,
      }),
    ).not.toThrow();
  });
});

describe('events RPC registration question answer schema', () => {
  it('accepts registration question answers during direct registration and waitlist writes', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventsRegisterForEventPayload)({
        addOns: [
          {
            addOnId: 'addon-1',
            quantity: 1,
          },
        ],
        answers: [
          {
            answer: 'Alice Example',
            questionId: 'question-1',
          },
        ],
        eventId: 'event-1',
        guestCount: 0,
        registrationOptionId: 'option-1',
      }),
    ).not.toThrow();

    expect(() =>
      Schema.decodeUnknownSync(EventsJoinWaitlistPayload)({
        answers: [
          {
            answer: 'Alice Example',
            questionId: 'question-1',
          },
        ],
        eventId: 'event-1',
        registrationOptionId: 'option-1',
      }),
    ).not.toThrow();
  });
});
