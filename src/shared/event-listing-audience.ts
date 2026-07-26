import { literalUnion } from '@shared/schema-utilities';
import { Schema } from 'effect';

export const eventListingAudiences = [
  'participant',
  'organizer',
  'both',
  'unlisted',
] as const;

export const EventListingAudience = literalUnion(...eventListingAudiences);

export type EventListingAudience = Schema.Schema.Type<
  typeof EventListingAudience
>;

export const eventListingAudienceLabels: Record<EventListingAudience, string> =
  {
    both: 'Participants and organizers',
    organizer: 'Organizers',
    participant: 'Participants',
    unlisted: 'Unlisted',
  };

export const eventListingAudienceDescriptions: Record<
  EventListingAudience,
  string
> = {
  both: 'Visible to people eligible for a participant or organizer registration option.',
  organizer:
    'Visible to people eligible for at least one organizer registration option.',
  participant:
    'Visible to people eligible for at least one participant registration option.',
  unlisted: 'Hidden from event discovery; use a direct link.',
};

export const eventListingAudienceLabel = (
  audience: EventListingAudience,
): string => eventListingAudienceLabels[audience];
