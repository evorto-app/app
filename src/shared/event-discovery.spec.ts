import { describe, expect, it } from 'vitest';

import {
  eventDiscoveryDescription,
  eventDiscoveryLabel,
} from './event-discovery';

describe('event visibility presentation', () => {
  it('explains sign-up events and announcements in product language', () => {
    expect(
      eventDiscoveryLabel({
        announcementRoleCount: 0,
        hasRegistrationOptions: true,
      }),
    ).toBe('Sign-up event');
    expect(
      eventDiscoveryLabel({
        announcementRoleCount: 2,
        hasRegistrationOptions: false,
      }),
    ).toBe('Announcement');
    expect(
      eventDiscoveryLabel({
        announcementRoleCount: 0,
        hasRegistrationOptions: false,
      }),
    ).toBe('Direct link only');
    const ordinaryEventDescription = eventDiscoveryDescription({
      announcementRoleCount: 0,
      hasRegistrationOptions: true,
    });
    expect(ordinaryEventDescription).toContain('available to new members');
    expect(ordinaryEventDescription).toContain(
      'Sign-in is still required before signing up',
    );
    expect(
      eventDiscoveryDescription({
        announcementRoleCount: 1,
        hasRegistrationOptions: false,
      }),
    ).toContain('does not change what they can do or send them a message');
  });
});
