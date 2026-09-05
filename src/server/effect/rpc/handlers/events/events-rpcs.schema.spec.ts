import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
  MAX_REGISTRATION_GUESTS,
} from '@shared/registration-quantity-limits';
import {
  MAX_REGISTRATION_ANSWER_LENGTH,
  MAX_REGISTRATION_QUESTIONS,
} from '@shared/registration-question-limits';
import {
  RegistrationTransfersClaim,
  RegistrationTransfersGetClaim,
} from '@shared/rpc-contracts/app-rpcs/registration-transfers.rpcs';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  EventGraphAddonInput,
  EventGraphEditRecord,
  EventGraphRegistrationOptionInput,
  EventReviewStatus,
  EventsApproveRegistrationResult,
  EventsCancelEventRegistration,
  EventsCancellableRegistrationStatus,
  EventsCancelRegistration,
  EventsCreateRegistrationOptionInput,
  EventsEventListInput,
  EventsEventListRecord,
  EventsFindOneAddon,
  EventsFindOneForEditRegistrationOption,
  EventsFindOneRegistrationOption,
  EventsGetOrganizeOverviewUser,
  EventsJoinWaitlistPayload,
  EventsOutgoingRegistrationTransferRecord,
  EventsPurchaseRegistrationAddonPayload,
  EventsPurchaseRegistrationAddonResult,
  EventsRegisterForEventPayload,
  EventsRegistrationAddonRecord,
  EventsRegistrationStatus,
  EventsRegistrationStatusRecord,
} from '../../../../../shared/rpc-contracts/app-rpcs/events.rpcs';
import { EventLocation } from '../../../../../types/location';

describe('events RPC list input schema', () => {
  it('accepts only bounded integer pages and canonical UTC timestamps', () => {
    expect(
      Schema.decodeUnknownSync(EventsEventListInput)({
        includeUnlisted: true,
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

describe('events RPC list record schema', () => {
  const record = {
    announcementRoleCount: 0,
    hasRegistrationOptions: true,
    icon: { iconColor: 0, iconName: 'circle' },
    id: 'event-1',
    start: '2026-07-15T14:30:00.000Z',
    status: 'APPROVED',
    title: 'Example event',
  };

  it('accepts absence and every explicit participant sign-up state', () => {
    for (const userSignUpState of [
      null,
      'approvalPending',
      'confirmed',
      'paymentRequired',
      'waitlisted',
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(EventsEventListRecord)({
          ...record,
          userSignUpState,
        }),
      ).not.toThrow();
    }
  });

  it('rejects the former boolean and unknown sign-up states', () => {
    for (const userSignUpState of [true, false, 'unknown']) {
      expect(() =>
        Schema.decodeUnknownSync(EventsEventListRecord)({
          ...record,
          userSignUpState,
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
      pendingCheckoutExpired: false,
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

describe('private registration transfer claim schema', () => {
  it('accepts the authoritative fixed bundle and current zero-payment recipient price', () => {
    const bundle = {
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
    };
    const decoded = Schema.decodeUnknownSync(
      RegistrationTransfersGetClaim.successSchema,
    )({
      bundle,
      event: {
        end: '2026-07-12T20:00:00.000Z',
        id: 'event-1',
        start: '2026-07-12T16:00:00.000Z',
        title: 'Workshop',
      },
      expiresAt: '2026-07-12T15:00:00.000Z',
      recipientBundlePrice: 0,
      refundLifecycle: null,
      registrationOption: {
        appliedDiscountType: 'esnCard',
        basePrice: 1200,
        currency: 'EUR',
        currentPrice: 0,
        description: null,
        discountAmount: 1200,
        id: 'option-1',
        isPaid: true,
        questions: [],
        title: 'Participant',
      },
      status: 'open',
      transferId: 'transfer-1',
    });
    expect(decoded.bundle).toMatchObject(bundle);
    expect(decoded.recipientBundlePrice).toBe(0);
    expect(decoded.registrationOption).toMatchObject({
      basePrice: 1200,
      currentPrice: 0,
      discountAmount: 1200,
    });
  });

  it('requires the private claim code and recipient answers when confirming', () => {
    const claimCode = 'ABCD-1234-EF56-7890-ABCD-1234-EF56-7890';
    const decode = Schema.decodeUnknownSync(
      RegistrationTransfersClaim.payloadSchema,
    );
    expect(decode({ answers: [], claimCode })).toMatchObject({
      answers: [],
      claimCode,
    });
    expect(() => decode({ answers: [] })).toThrow();
    expect(() => decode({ claimCode })).toThrow();
    expect(() =>
      decode({
        eventId: 'event-1',
        previewVersion: 'preview-version-1',
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
    esnCardDiscountedPrice: null,
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

  it('requires an explicit nullable ESNcard snapshot and accepts only whole nonnegative minor units', () => {
    for (const esnCardDiscountedPrice of [null, 0, 350]) {
      const decoded = Schema.decodeUnknownSync(
        EventsCreateRegistrationOptionInput,
      )({
        ...writableRegistrationOption,
        esnCardDiscountedPrice,
        isPaid: true,
        price: 1000,
        stripeTaxRateId: 'txr_test',
      });
      expect(decoded.esnCardDiscountedPrice).toBe(esnCardDiscountedPrice);
    }
    for (const esnCardDiscountedPrice of [undefined, -1, 0.5, NaN, Infinity]) {
      expect(() =>
        Schema.decodeUnknownSync(EventsCreateRegistrationOptionInput)({
          ...writableRegistrationOption,
          esnCardDiscountedPrice,
        }),
      ).toThrow();
    }
    const omitted = { ...writableRegistrationOption };
    Reflect.deleteProperty(omitted, 'esnCardDiscountedPrice');
    expect(() =>
      Schema.decodeUnknownSync(EventsCreateRegistrationOptionInput)(omitted),
    ).toThrow();
  });

  it('preserves source option identity with edited, removed and zero ESNcard prices', () => {
    for (const esnCardDiscountedPrice of [350, null, 0]) {
      const decoded = Schema.decodeUnknownSync(
        EventsCreateRegistrationOptionInput,
      )({
        ...writableRegistrationOption,
        esnCardDiscountedPrice,
        isPaid: true,
        price: 1000,
        sourceTemplateRegistrationOptionId: 'template-option-1',
        stripeTaxRateId: 'txr_test',
      });
      expect(decoded.sourceTemplateRegistrationOptionId).toBe(
        'template-option-1',
      );
      expect(decoded.esnCardDiscountedPrice).toBe(esnCardDiscountedPrice);
    }
    for (const sourceTemplateRegistrationOptionId of ['', null]) {
      expect(() =>
        Schema.decodeUnknownSync(EventsCreateRegistrationOptionInput)({
          ...writableRegistrationOption,
          sourceTemplateRegistrationOptionId,
        }),
      ).toThrow();
    }
  });

  it('carries inclusive tax-rate label details for paid event cards', () => {
    const publicOption = {
      appliedDiscountType: null,
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
      registrationMode: 'fcfs',
      reservedSpots: 0,
      spots: 10,
      taxRateDisplayName: 'VAT',
      taxRatePercentage: '19',
      title: 'Participant',
    } satisfies Schema.Schema.Type<typeof EventsFindOneRegistrationOption>;
    const optionWithPrivateFields = {
      ...publicOption,
      checkedInSpots: 7,
      registeredDescription: 'Private instructions shown after sign-up.',
      roleIds: ['private-role-1'],
      stripeTaxRateId: 'txr_vat_19',
    };
    const decode = Schema.decodeUnknownSync(EventsFindOneRegistrationOption);

    expect(() => decode(optionWithPrivateFields)).not.toThrow();
    const decoded = decode(optionWithPrivateFields);
    expect(decoded).toEqual(publicOption);
    expect(decoded).not.toHaveProperty('checkedInSpots');
    expect(decoded).not.toHaveProperty('registeredDescription');
    expect(decoded).not.toHaveProperty('roleIds');
    expect(decoded).not.toHaveProperty('stripeTaxRateId');
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

  it('accepts supported modes and rejects retired values in event reads and writes', () => {
    for (const registrationMode of ['fcfs', 'application']) {
      const option = { ...writableOption, registrationMode };
      expect(
        Schema.decodeUnknownSync(EventsFindOneForEditRegistrationOption)(option)
          .registrationMode,
      ).toBe(registrationMode);
      expect(
        Schema.decodeUnknownSync(EventGraphRegistrationOptionInput)(option)
          .registrationMode,
      ).toBe(registrationMode);
    }
    const retiredOption = { ...writableOption, registrationMode: 'random' };
    expect(() =>
      Schema.decodeUnknownSync(EventsFindOneForEditRegistrationOption)(
        retiredOption,
      ),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventGraphRegistrationOptionInput)(
        retiredOption,
      ),
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

  it('rejects registration inputs that exceed practical checkout limits', () => {
    const registrationPayload = {
      addOns: [],
      answers: [],
      eventId: 'event-1',
      guestCount: 0,
      registrationOptionId: 'option-1',
    };

    expect(() =>
      Schema.decodeUnknownSync(EventsRegisterForEventPayload)({
        ...registrationPayload,
        guestCount: MAX_REGISTRATION_GUESTS + 1,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventsRegisterForEventPayload)({
        ...registrationPayload,
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
        ...registrationPayload,
        addOns: Array.from(
          { length: MAX_EVENT_ADDON_TYPES + 1 },
          (_, index) => ({ addOnId: `addon-${index}`, quantity: 1 }),
        ),
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventsJoinWaitlistPayload)({
        answers: Array.from(
          { length: MAX_REGISTRATION_QUESTIONS + 1 },
          (_, index) => ({
            answer: 'Answer',
            questionId: `question-${index}`,
          }),
        ),
        eventId: 'event-1',
        registrationOptionId: 'option-1',
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(EventsRegisterForEventPayload)({
        ...registrationPayload,
        answers: [
          {
            answer: 'a'.repeat(MAX_REGISTRATION_ANSWER_LENGTH + 1),
            questionId: 'question-1',
          },
        ],
      }),
    ).toThrow();
  });
});

describe('registration input boundary maxima', () => {
  it('accepts the guest, add-on, and answer caps together', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventsRegisterForEventPayload)({
        addOns: Array.from({ length: MAX_EVENT_ADDON_TYPES }, (_, index) => ({
          addOnId: `addon-${index}`,
          quantity: MAX_REGISTRATION_ADDON_QUANTITY,
        })),
        answers: Array.from(
          { length: MAX_REGISTRATION_QUESTIONS },
          (_, index) => ({
            answer: 'a'.repeat(MAX_REGISTRATION_ANSWER_LENGTH),
            questionId: `question-${index}`,
          }),
        ),
        eventId: 'event-1',
        guestCount: MAX_REGISTRATION_GUESTS,
        registrationOptionId: 'option-1',
      }),
    ).not.toThrow();
  });

  it('rejects fractional and nonfinite guest quantities at the RPC boundary', () => {
    for (const guestCount of [-1, 0.5, Infinity, NaN]) {
      expect(() =>
        Schema.decodeUnknownSync(EventsRegisterForEventPayload)({
          eventId: 'event-1',
          guestCount,
          registrationOptionId: 'option-1',
        }),
      ).toThrow();
    }
  });
});
