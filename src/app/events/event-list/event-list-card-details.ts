import type {
  EventsEventListFillLevel,
  EventsEventListRecord,
} from '@shared/rpc-contracts/app-rpcs/events.rpcs';

export type EventListCardAvailability =
  | {
      readonly fillLevel: EventsEventListFillLevel | null;
      readonly kind: 'open';
      readonly text: string;
    }
  | { readonly kind: 'closed'; readonly text: string }
  | { readonly kind: 'full'; readonly text: string }
  | {
      readonly kind: 'opens';
      readonly opensAt: string;
      readonly text: string;
    };

export interface EventListCardDetails {
  readonly availability: EventListCardAvailability | null;
  readonly organizers: null | string;
  readonly price: EventListCardPrice | null;
}

export type EventListCardPrice =
  | { readonly amountCents: 0; readonly kind: 'free'; readonly prefix: '' }
  | {
      readonly amountCents: number;
      readonly kind: 'from' | 'single';
      readonly prefix: string;
    };

const fillLevelText: Record<EventsEventListFillLevel, string> = {
  few: 'Few spots left',
  many: 'Many free spots',
  some: 'Some spots left',
};

const openText = (
  signUp: NonNullable<EventsEventListRecord['participantSignUp']>,
): string => {
  if (signUp.exactSpots) {
    return signUp.exactSpots.spotsLeft === 1
      ? '1 spot left'
      : `${signUp.exactSpots.spotsLeft} of ${signUp.exactSpots.capacity} spots left`;
  }
  return signUp.fillLevel ? fillLevelText[signUp.fillLevel] : 'Sign-up open';
};

const availability = (
  signUp: NonNullable<EventsEventListRecord['participantSignUp']>,
): EventListCardAvailability => {
  switch (signUp.availability) {
    case 'closed': {
      return { kind: 'closed', text: 'Sign-up closed' };
    }
    case 'full': {
      return { kind: 'full', text: 'Event is full' };
    }
    case 'open': {
      return {
        fillLevel: signUp.fillLevel,
        kind: 'open',
        text: openText(signUp),
      };
    }
    case 'opens': {
      return { kind: 'opens', opensAt: signUp.opensAt, text: 'Opens' };
    }
  }
};

const price = (
  signUp: NonNullable<EventsEventListRecord['participantSignUp']>,
): EventListCardPrice => {
  if (signUp.highestPrice === 0) {
    return { amountCents: 0, kind: 'free', prefix: '' };
  }
  return signUp.lowestPrice === signUp.highestPrice
    ? { amountCents: signUp.lowestPrice, kind: 'single', prefix: '' }
    : { amountCents: signUp.lowestPrice, kind: 'from', prefix: 'From ' };
};

/**
 * Pure mapping from the list record to the labels shown on an event card.
 * The server decides availability, so server render and hydration agree.
 * Prices stay in cents so the template formats them with the app currency.
 */
export const eventListCardDetails = (
  record: Pick<EventsEventListRecord, 'organizerSlots' | 'participantSignUp'>,
): EventListCardDetails => ({
  availability: record.participantSignUp
    ? availability(record.participantSignUp)
    : null,
  organizers: record.organizerSlots
    ? `${record.organizerSlots.filled} of ${record.organizerSlots.capacity} ${
        record.organizerSlots.capacity === 1 ? 'organizer' : 'organizers'
      }`
    : null,
  price: record.participantSignUp ? price(record.participantSignUp) : null,
});
