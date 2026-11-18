import type { EventsEventListRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { describe, expect, it } from 'vitest';

import { eventListCardDetails } from './event-list-card-details';

const signUp: NonNullable<EventsEventListRecord['participantSignUp']> = {
  availability: 'open',
  closesAt: '2030-01-20T12:00:00.000Z',
  exactSpots: null,
  fillLevel: 'many',
  highestPrice: 0,
  lowestPrice: 0,
  opensAt: '2030-01-01T12:00:00.000Z',
};
const record = (
  participantSignUp: EventsEventListRecord['participantSignUp'],
  organizerSlots: EventsEventListRecord['organizerSlots'] = null,
) => ({ organizerSlots, participantSignUp });

describe('eventListCardDetails', () => {
  it('shows nothing for events without a participant sign-up', () => {
    expect(eventListCardDetails(record(null))).toEqual({
      availability: null,
      organizers: null,
      price: null,
    });
  });

  it('announces when sign-up opens', () => {
    expect(
      eventListCardDetails(
        record({
          ...signUp,
          availability: 'opens',
          opensAt: '2030-01-12T08:00:00.000Z',
        }),
      ).availability,
    ).toEqual({
      kind: 'opens',
      opensAt: '2030-01-12T08:00:00.000Z',
      text: 'Opens',
    });
  });

  it('reports closed sign-up', () => {
    expect(
      eventListCardDetails(record({ ...signUp, availability: 'closed' }))
        .availability,
    ).toEqual({ kind: 'closed', text: 'Sign-up closed' });
  });

  it('reports a full event', () => {
    expect(
      eventListCardDetails(
        record({ ...signUp, availability: 'full', fillLevel: null }),
      ).availability,
    ).toEqual({ kind: 'full', text: 'Event is full' });
  });

  it('describes how full an open event is without exact counts', () => {
    const text = (fillLevel: 'few' | 'many' | 'some') =>
      eventListCardDetails(record({ ...signUp, fillLevel })).availability;
    expect(text('many')).toEqual({
      fillLevel: 'many',
      kind: 'open',
      text: 'Many free spots',
    });
    expect(text('some')).toEqual({
      fillLevel: 'some',
      kind: 'open',
      text: 'Some spots left',
    });
    expect(text('few')).toEqual({
      fillLevel: 'few',
      kind: 'open',
      text: 'Few spots left',
    });
  });

  it('shows exact spots with singular and plural wording for organizers', () => {
    expect(
      eventListCardDetails(
        record({
          ...signUp,
          exactSpots: { capacity: 20, spotsLeft: 8 },
          fillLevel: 'some',
        }),
      ).availability,
    ).toEqual({ fillLevel: 'some', kind: 'open', text: '8 of 20 spots left' });
    expect(
      eventListCardDetails(
        record({
          ...signUp,
          exactSpots: { capacity: 20, spotsLeft: 1 },
          fillLevel: 'few',
        }),
      ).availability,
    ).toEqual({ fillLevel: 'few', kind: 'open', text: '1 spot left' });
  });

  it('falls back to a plain label when no fill level is sent', () => {
    expect(
      eventListCardDetails(record({ ...signUp, fillLevel: null })).availability,
    ).toEqual({ fillLevel: null, kind: 'open', text: 'Sign-up open' });
  });

  it('labels free, single-price and from-price events', () => {
    expect(eventListCardDetails(record(signUp)).price).toEqual({
      amountCents: 0,
      kind: 'free',
      prefix: '',
    });
    expect(
      eventListCardDetails(
        record({ ...signUp, highestPrice: 1250, lowestPrice: 1250 }),
      ).price,
    ).toEqual({ amountCents: 1250, kind: 'single', prefix: '' });
    expect(
      eventListCardDetails(
        record({ ...signUp, highestPrice: 2000, lowestPrice: 500 }),
      ).price,
    ).toEqual({ amountCents: 500, kind: 'from', prefix: 'From ' });
  });

  it('shows organizer slots only when present', () => {
    expect(
      eventListCardDetails(record(null, { capacity: 4, filled: 1 })).organizers,
    ).toBe('1 of 4 organizers');
    expect(eventListCardDetails(record(signUp)).organizers).toBeNull();
  });
});
