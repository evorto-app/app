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

export const eventDiscoveryLabel = ({
  announcementRoleCount,
  hasRegistrationOptions,
  listingAudience,
}: {
  announcementRoleCount: number;
  hasRegistrationOptions: boolean;
  listingAudience: EventListingAudience;
}): string =>
  hasRegistrationOptions
    ? eventListingAudienceLabel(listingAudience)
    : announcementRoleCount > 0
      ? 'Announcement'
      : 'Link only';

export const eventDiscoveryDescription = ({
  announcementRoleCount,
  hasRegistrationOptions,
  listingAudience,
}: {
  announcementRoleCount: number;
  hasRegistrationOptions: boolean;
  listingAudience: EventListingAudience;
}): string => {
  if (hasRegistrationOptions) {
    return eventListingAudienceDescriptions[listingAudience];
  }
  return announcementRoleCount > 0
    ? 'Shown in event discovery to people with at least one selected role. This does not grant access or send notifications.'
    : 'Hidden from event discovery; use a direct link.';
};
