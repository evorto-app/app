import { describe, expect, it } from 'vitest';

import {
  eventDiscoveryDescription,
  eventDiscoveryLabel,
} from './event-discovery';

describe('event discovery presentation', () => {
  it('labels option-derived and announcement discovery truthfully', () => {
    expect(
      eventDiscoveryLabel({
        announcementRoleCount: 0,
        hasRegistrationOptions: true,
      }),
    ).toBe('Eligibility based');
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
    ).toBe('Link only');
    const ordinaryEventDescription = eventDiscoveryDescription({
      announcementRoleCount: 0,
      hasRegistrationOptions: true,
    });
    expect(ordinaryEventDescription).toContain(
      'roles assigned by default to new members',
    );
    expect(ordinaryEventDescription).toContain(
      'Eligibility is checked again when someone registers',
    );
    expect(
      eventDiscoveryDescription({
        announcementRoleCount: 1,
        hasRegistrationOptions: false,
      }),
    ).toContain('does not grant access or send notifications');
  });
});
