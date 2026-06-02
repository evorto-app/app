import { describe, expect, it } from '@effect/vitest';

import { organizerRegistrationTransferAvailable } from './events-query.handlers';
import { eventHandlers } from './events.handlers';

describe('eventHandlers composition', () => {
  it('contains the full events rpc handler set', () => {
    expect(Object.keys(eventHandlers).toSorted()).toEqual([
      'events.canOrganize',
      'events.cancelEventRegistration',
      'events.cancelPendingRegistration',
      'events.cancelRegistration',
      'events.checkInRegistration',
      'events.create',
      'events.createRegistrationTransferIntent',
      'events.eventList',
      'events.findOne',
      'events.findOneForEdit',
      'events.findTransferTargets',
      'events.getOrganizeOverview',
      'events.getPendingReviews',
      'events.getRegistrationStatus',
      'events.joinWaitlist',
      'events.registerForEvent',
      'events.registerWithTransferCode',
      'events.registrationScanned',
      'events.reviewEvent',
      'events.submitForReview',
      'events.transferEventRegistration',
      'events.transferMyRegistration',
      'events.update',
      'events.updateListing',
    ]);
  });
});

describe('organizerRegistrationTransferAvailable', () => {
  it('keeps organizer-assisted transfer unavailable for paid, checked-in, or past registrations', () => {
    const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

    expect(
      organizerRegistrationTransferAvailable({
        checkInTime: null,
        eventStart: futureStart,
        transactions: [],
      }),
    ).toBe(true);
    expect(
      organizerRegistrationTransferAvailable({
        checkInTime: new Date(),
        eventStart: futureStart,
        transactions: [],
      }),
    ).toBe(false);
    expect(
      organizerRegistrationTransferAvailable({
        checkInTime: null,
        eventStart: pastStart,
        transactions: [],
      }),
    ).toBe(false);
    expect(
      organizerRegistrationTransferAvailable({
        checkInTime: null,
        eventStart: futureStart,
        transactions: [
          {
            amount: 2500,
            status: 'successful',
          },
        ],
      }),
    ).toBe(false);
  });
});
