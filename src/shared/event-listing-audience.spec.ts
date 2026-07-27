import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  eventDiscoveryDescription,
  eventDiscoveryLabel,
  EventListingAudience,
  eventListingAudiences,
} from './event-listing-audience';

describe('EventListingAudience', () => {
  it('accepts exactly the four product audiences', () => {
    for (const audience of eventListingAudiences) {
      expect(Schema.decodeUnknownSync(EventListingAudience)(audience)).toBe(
        audience,
      );
    }

    for (const unsupported of [false, true, 'listed', 'participants']) {
      expect(() =>
        Schema.decodeUnknownSync(EventListingAudience)(unsupported),
      ).toThrow();
    }
  });

  it('keeps optionful audiences and labels optionless discovery truthfully', () => {
    expect(
      eventDiscoveryLabel({
        announcementRoleCount: 0,
        hasRegistrationOptions: true,
        listingAudience: 'organizer',
      }),
    ).toBe('Organizers');
    expect(
      eventDiscoveryLabel({
        announcementRoleCount: 2,
        hasRegistrationOptions: false,
        listingAudience: 'unlisted',
      }),
    ).toBe('Announcement');
    expect(
      eventDiscoveryLabel({
        announcementRoleCount: 0,
        hasRegistrationOptions: false,
        listingAudience: 'both',
      }),
    ).toBe('Link only');
    expect(
      eventDiscoveryDescription({
        announcementRoleCount: 1,
        hasRegistrationOptions: false,
        listingAudience: 'both',
      }),
    ).toContain('does not grant access or send notifications');
  });
});
