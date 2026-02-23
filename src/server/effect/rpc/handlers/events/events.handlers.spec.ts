import { describe, expect, it } from 'vitest';

import { eventHandlers } from './events.handlers';

describe('eventHandlers composition', () => {
  it('contains the full events rpc handler set', () => {
    expect(Object.keys(eventHandlers).toSorted()).toEqual([
      'events.canOrganize',
      'events.cancelPendingRegistration',
      'events.create',
      'events.eventList',
      'events.findOne',
      'events.findOneForEdit',
      'events.getOrganizeOverview',
      'events.getPendingReviews',
      'events.getRegistrationStatus',
      'events.registerForEvent',
      'events.registrationScanned',
      'events.reviewEvent',
      'events.submitForReview',
      'events.update',
      'events.updateListing',
    ]);
  });
});
