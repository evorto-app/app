import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  EventsFindOneAddon,
  EventsFindOneRegistrationOption,
  EventsGetOrganizeOverviewUser,
  EventsJoinWaitlistPayload,
  EventsRegisterForEventPayload,
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
        addonPurchases: [],
        eventId: 'event-1',
        guestCount: 0,
        id: 'registration-1',
        paidTransferCodeAvailable: false,
        paymentPending: false,
        registrationOptionId: 'option-1',
        registrationOptionTitle: 'Participant',
        status: 'UNKNOWN',
        transferAvailable: false,
      }),
    ).toThrow();
  });

  it('carries purchased add-ons on active registration records', () => {
    expect(() =>
      Schema.decodeUnknownSync(EventsRegistrationStatusRecord)({
        addonPurchases: [
          {
            quantity: 2,
            title: 'Workshop kit',
            unitPrice: 500,
          },
        ],
        eventId: 'event-1',
        guestCount: 0,
        id: 'registration-1',
        paidTransferCodeAvailable: false,
        paymentPending: false,
        registrationOptionId: 'option-1',
        registrationOptionTitle: 'Participant',
        status: 'CONFIRMED',
        transferAvailable: false,
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
        registrationId: 'registration-1',
        transferAvailable: true,
        userId: 'user-1',
      }),
    ).not.toThrow();
  });
});

describe('events RPC registration option schema', () => {
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
            quantity: 1,
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
