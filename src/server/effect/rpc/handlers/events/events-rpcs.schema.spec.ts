import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  EventsFindOneAddon,
  EventsFindOneRegistrationOption,
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
        id: 'registration-1',
        paymentPending: false,
        registrationOptionId: 'option-1',
        registrationOptionTitle: 'Participant',
        status: 'UNKNOWN',
        transferAvailable: false,
      }),
    ).toThrow();
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
