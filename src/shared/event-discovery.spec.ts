import { describe, expect, it } from 'vitest';

import {
  eventDiscoveryDescription,
  eventDiscoveryLabel,
} from './event-discovery';

describe('event discovery presentation', () => {
  it('distinguishes sign-up choices, selected roles, and link-only events', () => {
    expect(
      eventDiscoveryLabel({
        announcementRoleCount: 0,
        hasRegistrationOptions: true,
      }),
    ).toBe('Based on sign-up choices');
    expect(
      eventDiscoveryLabel({
        announcementRoleCount: 2,
        hasRegistrationOptions: false,
      }),
    ).toBe('Shown to selected roles');
    expect(
      eventDiscoveryLabel({
        announcementRoleCount: 0,
        hasRegistrationOptions: false,
      }),
    ).toBe('Only through its link');
  });

  it('explains role-selected announcement visibility without implying access', () => {
    expect(
      eventDiscoveryDescription({
        announcementRoleCount: 1,
        hasRegistrationOptions: false,
      }),
    ).toBe(
      'Members with at least one selected role see this announcement in Events. This setting does not give anyone a role or send a message.',
    );
  });

  it('explains link-only announcement visibility', () => {
    expect(
      eventDiscoveryDescription({
        announcementRoleCount: 0,
        hasRegistrationOptions: false,
      }),
    ).toBe(
      'This announcement does not appear in Events. People can still open its direct link.',
    );
  });
});
