import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
  MAX_REGISTRATION_GUESTS,
} from '@shared/registration-quantity-limits';
import {
  MAX_REGISTRATION_ANSWER_LENGTH,
  MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
  MAX_REGISTRATION_QUESTION_TITLE_LENGTH,
  MAX_REGISTRATION_QUESTIONS,
} from '@shared/registration-question-limits';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  EventGraphAddonInput,
  EventGraphEditRecord,
  EventGraphQuestionInput,
  EventReviewStatus,
  EventsApproveRegistrationResult,
  EventsCancelEventRegistration,
  EventsCancellableRegistrationStatus,
  EventsCancelRegistration,
  EventsCreateRegistrationOptionInput,
  EventsEventListInput,
  EventsFindOneAddon,
  EventsFindOneRegistrationOption,
  EventsGetOrganizeOverviewUser,
  EventsJoinWaitlistPayload,
  EventsOutgoingRegistrationTransferRecord,
  EventsPreviewEventRegistrationTransfer,
  EventsPurchaseRegistrationAddonPayload,
  EventsPurchaseRegistrationAddonResult,
  EventsRegisterForEventPayload,
  EventsRegistrationAddonRecord,
  EventsRegistrationStatus,
  EventsRegistrationStatusRecord,
  EventsTransferEventRegistration,
} from '../../../../../shared/rpc-contracts/app-rpcs/events.rpcs';
import { EventLocation } from '../../../../../types/location';

describe('events RPC list input schema', () => {
  it('accepts only bounded integer pages and canonical UTC timestamps', () => {
    expect(
      Schema.decodeUnknownSync(EventsEventListInput)({
        limit: 100,
        offset: 0,
        startAfter: '2026-07-15T14:30:00.000Z',
        status: ['APPROVED'],
        userId: 'untrusted-client-user',
      }),
    ).toEqual({
      limit: 100,
      offset: 0,
      startAfter: '2026-07-15T14:30:00.000Z',
      status: ['APPROVED'],
    });

    for (const input of [
      { limit: 0, offset: 0, startAfter: '2026-07-15T14:30:00.000Z' },
      { limit: 101, offset: 0, startAfter: '2026-07-15T14:30:00.000Z' },
      { limit: 10.5, offset: 0, startAfter: '2026-07-15T14:30:00.000Z' },
      { limit: 10, offset: -1, startAfter: '2026-07-15T14:30:00.000Z' },
      { limit: 10, offset: 0.5, startAfter: '2026-07-15T14:30:00.000Z' },
      { limit: 10, offset: 0, startAfter: 'not-a-timestamp' },
      {
        limit: 10,
        offset: 0,
        startAfter: '2026-07-15T16:30:00.000+02:00',
      },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(EventsEventListInput)({
          status: ['APPROVED'],
          ...input,
        }),
      ).toThrow();
    }
  });
});

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
  it('represents source-owner refund progress after ticket ownership moves', () => {
    for (const refundStatus of [
      'completed',
      'needsAttention',
      'notRequired',
      'processing',
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(EventsOutgoingRegistrationTransferRecord)({
          currency: 'EUR',
          refundAmount: refundStatus === 'notRequired' ? 0 : 1200,
          refundStatus,
          registrationOptionTitle: 'Participant',
          transferId: 'transfer-1',
          transferredAt: '2026-08-01T17:00:00.000Z',
        }),
      ).not.toThrow();
    }
  });

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
        cancellationAvailable: true,
        cancellationBlockedReason: 'none',
        guestCount: 0,
        id: 'registration-1',
        organizingRegistration: false,
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
        cancellationAvailable: false,
        cancellationBlockedReason: 'checkedIn',
        guestCount: 0,
        id: 'registration-1',
        organizingRegistration: false,
        paymentPending: false,
        registrationAddOns: [],
        registrationOptionId: 'option-1',
        registrationOptionTitle: 'Participant',
        status: 'CONFIRMED',
        transferAvailable: true,
        transferBlockedReason: 'none',
      }),
    ).not.toThrow();
  });

  it('represents transfer blockers enforced by the offer flow', () => {
    for (const transferBlockedReason of [
      'activeTransfer',
      'addonPaymentPending',
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(EventsRegistrationStatusRecord)({
          activeTransfer: null,
          addonPurchases: [],
          cancellationAvailable: false,
          cancellationBlockedReason: 'deadlinePassed',
          guestCount: 0,
          id: 'registration-1',
          organizingRegistration: false,
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
            refundLifecycle:
              status === 'refund_failed'
                ? { state: 'needsAttention' }
                : status === 'refund_pending'
                  ? { state: 'processing' }
                  : null,
            registrationSide: 'source',
            status,
            transferId: 'transfer-1',
          },
          addonPurchases: [],
          cancellationAvailable: true,
          cancellationBlockedReason: 'none',
          guestCount: 0,
          id: 'registration-1',
          organizingRegistration: false,
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
            quantity: 3,
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
        userId: 'user-1',
      }),
    ).not.toThrow();
  });
});

describe('events RPC cancellation precondition schema', () => {
  it('accepts only cancellable registration statuses', () => {
    for (const status of ['CONFIRMED', 'PENDING', 'WAITLIST']) {
      expect(() =>
        Schema.decodeUnknownSync(EventsCancellableRegistrationStatus)(status),
      ).not.toThrow();
    }

    expect(() =>
      Schema.decodeUnknownSync(EventsCancellableRegistrationStatus)(
        'CANCELLED',
      ),
    ).toThrow();
  });

  it('requires the confirmed status and payment state on both cancellation RPCs', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventsCancelRegistration.payloadSchema)({
        expectedPaymentPending: false,
        expectedStatus: 'CONFIRMED',
        registrationId: 'registration-1',
      }),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventsCancelEventRegistration.payloadSchema)({
        eventId: 'event-1',
        expectedPaymentPending: true,
        expectedStatus: 'PENDING',
        registrationId: 'registration-1',
      }),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventsCancelRegistration.payloadSchema)({
        expectedStatus: 'CONFIRMED',
        registrationId: 'registration-1',
      }),
    ).toThrow();
  });
});

describe('events organizer direct-transfer preview schema', () => {
  it('accepts the authoritative fixed-bundle and zero-payment preview', () => {
    expect(() =>
      Schema.decodeUnknownSync(
        EventsPreviewEventRegistrationTransfer.successSchema,
      )({
        bundle: {
          addOns: [
            {
              cancelledQuantity: 0,
              currentUnitPrice: 0,
              description: 'Workshop materials',
              id: 'addon-1',
              includedQuantity: 1,
              purchasedQuantity: 1,
              quantity: 2,
              redeemedQuantity: 1,
              remainingQuantity: 1,
              title: 'Workshop kit',
            },
          ],
          checkedInGuestCount: 1,
          checkInTime: '2026-07-12T16:00:00.000Z',
          guestCount: 2,
          guestUnitPrice: 0,
        },
        completionMode: 'databaseOnly',
        currency: 'EUR',
        previewVersion: 'preview-version-1',
        pricing: {
          appliedDiscountedPrice: 0,
          appliedDiscountType: 'esnCard',
          discountAmount: 1200,
          recipientBundlePrice: 0,
          recipientRegistrationPrice: 0,
          sourceRefundAmountDue: 0,
        },
        recipient: {
          email: 'recipient@example.com',
          firstName: 'Target',
          id: 'target-user-1',
          lastName: 'Recipient',
        },
        registrationOption: {
          currentPrice: 1200,
          id: 'option-1',
          title: 'Participant',
        },
        source: {
          email: 'source@example.com',
          firstName: 'Source',
          id: 'source-user-1',
          lastName: 'Owner',
        },
      }),
    ).not.toThrow();
  });

  it('requires the reviewed preview version when confirming', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventsTransferEventRegistration.payloadSchema)({
        eventId: 'event-1',
        previewVersion: 'preview-version-1',
        registrationId: 'registration-1',
        targetUserId: 'target-user-1',
      }),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventsTransferEventRegistration.payloadSchema)({
        eventId: 'event-1',
        registrationId: 'registration-1',
        targetUserId: 'target-user-1',
      }),
    ).toThrow();
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

  it('requires explicit event option policy inheritance values', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventsCreateRegistrationOptionInput)(
        writableRegistrationOption,
      ),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(EventsCreateRegistrationOptionInput)({
        ...writableRegistrationOption,
        cancellationDeadlineHoursBeforeStart: null,
        refundFeesOnCancellation: null,
        transferDeadlineHoursBeforeStart: null,
      }),
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
        registrationOptions: [writableOption],
        simpleModeEnabled: false,
        start: '2026-09-20T12:00:00.000Z',
        title: 'Event',
      }),
    ).not.toThrow();
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

  it('bounds question counts and question/answer text', () => {
    const question = {
      description: 'd'.repeat(MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH),
      key: 'question-1',
      registrationOptionKey: 'option-1',
      required: false,
      sortOrder: 0,
      title: 't'.repeat(MAX_REGISTRATION_QUESTION_TITLE_LENGTH),
    };
    expect(() =>
      Schema.decodeUnknownSync(EventGraphQuestionInput)(question),
    ).not.toThrow();
    for (const invalidQuestion of [
      {
        ...question,
        title: 't'.repeat(MAX_REGISTRATION_QUESTION_TITLE_LENGTH + 1),
      },
      {
        ...question,
        description: 'd'.repeat(
          MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH + 1,
        ),
      },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(EventGraphQuestionInput)(invalidQuestion),
      ).toThrow();
    }

    const basePayload = {
      eventId: 'event-1',
      guestCount: 0,
      registrationOptionId: 'option-1',
    };
    expect(() =>
      Schema.decodeUnknownSync(EventsRegisterForEventPayload)({
        ...basePayload,
        answers: Array.from(
          { length: MAX_REGISTRATION_QUESTIONS + 1 },
          (_, index) => ({
            answer: 'Answer',
            questionId: `question-${index}`,
          }),
        ),
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventsRegisterForEventPayload)({
        ...basePayload,
        answers: [
          {
            answer: 'a'.repeat(MAX_REGISTRATION_ANSWER_LENGTH + 1),
            questionId: 'question-1',
          },
        ],
      }),
    ).toThrow();
  });

  it('accepts registration quantity caps and rejects cap plus one', () => {
    const payload = {
      addOns: [
        {
          addOnId: 'addon-1',
          quantity: MAX_REGISTRATION_ADDON_QUANTITY,
        },
      ],
      eventId: 'event-1',
      guestCount: MAX_REGISTRATION_GUESTS,
      registrationOptionId: 'option-1',
    };

    expect(() =>
      Schema.decodeUnknownSync(EventsRegisterForEventPayload)(payload),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventsRegisterForEventPayload)({
        ...payload,
        guestCount: MAX_REGISTRATION_GUESTS + 1,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventsRegisterForEventPayload)({
        ...payload,
        addOns: [
          {
            addOnId: 'addon-1',
            quantity: MAX_REGISTRATION_ADDON_QUANTITY + 1,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventsRegisterForEventPayload)({
        ...payload,
        addOns: Array.from(
          { length: MAX_EVENT_ADDON_TYPES + 1 },
          (_, index) => ({
            addOnId: `addon-${index}`,
            quantity: 1,
          }),
        ),
      }),
    ).toThrow();
  });

  it('bounds post-registration add-on purchase quantities', () => {
    const payload = {
      addOnId: 'addon-1',
      operationKey: 'purchase-addon-1',
      quantity: MAX_REGISTRATION_ADDON_QUANTITY,
      registrationId: 'registration-1',
    };

    expect(() =>
      Schema.decodeUnknownSync(EventsPurchaseRegistrationAddonPayload)(payload),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventsPurchaseRegistrationAddonPayload)({
        ...payload,
        quantity: MAX_REGISTRATION_ADDON_QUANTITY + 1,
      }),
    ).toThrow();
  });
});
