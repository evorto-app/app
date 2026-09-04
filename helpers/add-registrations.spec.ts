import { describe, expect, it } from '@effect/vitest';

import {
  claimRegistrationSeedUsers,
  validateRegistrationSeedEventOwnership,
} from './add-registrations';

const users = [
  { id: 'tester' },
  { id: 'member-one' },
  { id: 'member-two' },
  { id: 'member-three' },
  { id: 'member-four' },
  { id: 'member-five' },
];

describe('claimRegistrationSeedUsers', () => {
  it('does not claim users when an option has no seeded registrations', () => {
    const selectedUserIdsForEvent = new Set<string>();
    const seededCountByUser = new Map<string, number>();

    expect(
      claimRegistrationSeedUsers(
        users,
        0,
        selectedUserIdsForEvent,
        seededCountByUser,
        new Set(),
      ),
    ).toEqual([]);
    expect(selectedUserIdsForEvent.size).toBe(0);
    expect(seededCountByUser.size).toBe(0);
  });

  it('claims a user at most once across registration options for one event', () => {
    const selectedUserIdsForEvent = new Set<string>();
    const seededCountByUser = new Map<string, number>();
    const testerUserIds = new Set(['tester']);

    const firstOption = claimRegistrationSeedUsers(
      users,
      3,
      selectedUserIdsForEvent,
      seededCountByUser,
      testerUserIds,
    );
    const secondOption = claimRegistrationSeedUsers(
      users,
      3,
      selectedUserIdsForEvent,
      seededCountByUser,
      testerUserIds,
    );

    expect(firstOption.map((user) => user.id)).toEqual([
      'tester',
      'member-one',
      'member-two',
    ]);
    expect(secondOption.map((user) => user.id)).toEqual([
      'member-three',
      'member-four',
      'member-five',
    ]);
    expect(
      new Set([...firstOption, ...secondOption].map((user) => user.id)).size,
    ).toBe(firstOption.length + secondOption.length);
  });

  it('keeps the lower global registration limit for authenticated test users', () => {
    const seededCountByUser = new Map<string, number>();
    const testerUserIds = new Set(['tester']);

    const firstEvent = claimRegistrationSeedUsers(
      users,
      users.length,
      new Set(),
      seededCountByUser,
      testerUserIds,
    );
    const secondEvent = claimRegistrationSeedUsers(
      users,
      users.length,
      new Set(),
      seededCountByUser,
      testerUserIds,
    );

    expect(firstEvent.map((user) => user.id)).toContain('tester');
    expect(secondEvent.map((user) => user.id)).not.toContain('tester');
    expect(seededCountByUser.get('tester')).toBe(1);
  });
});

describe('validateRegistrationSeedEventOwnership', () => {
  const event = {
    id: 'event-1',
    registrationOptions: [],
    start: new Date('2026-01-01T10:00:00.000Z'),
    tenantId: 'tenant-1',
    title: 'Event',
  };

  it('accepts events owned by the explicit seed tenant', () => {
    expect(() =>
      validateRegistrationSeedEventOwnership([event], 'tenant-1'),
    ).not.toThrow();
  });

  it('rejects a cross-tenant event instead of using another tenant as a fallback', () => {
    expect(() =>
      validateRegistrationSeedEventOwnership([event], 'tenant-2'),
    ).toThrow(
      'Cannot seed event event-1 for tenant tenant-2: event belongs to tenant-1',
    );
  });
});
