import { describe, expect, it } from '@effect/vitest';

import {
  requireSeedFixture,
  requireSeedRoles,
  requireSeedStripeTaxRates,
  requireSeedUserId,
} from './seed-requirements';

const roles = [
  {
    defaultOrganizerRole: false,
    defaultUserRole: false,
    id: 'admin-role',
    name: 'Admin',
  },
  {
    defaultOrganizerRole: true,
    defaultUserRole: false,
    id: 'organizer-role',
    name: 'Section member',
  },
  {
    defaultOrganizerRole: false,
    defaultUserRole: true,
    id: 'user-role',
    name: 'Regular user',
  },
];

describe('seed requirements', () => {
  it('returns only explicit required users and role groups', () => {
    expect(
      requireSeedUserId(
        [
          { id: 'first-user', roles: 'none' },
          { id: 'organizer-user', roles: 'organizer' },
        ],
        'organizer',
      ),
    ).toBe('organizer-user');
    expect(requireSeedRoles(roles)).toEqual({
      adminRole: roles[0],
      defaultOrganizerRoles: [roles[1]],
      defaultUserRoles: [roles[2]],
    });
  });

  it('rejects missing required users instead of selecting the first user', () => {
    expect(() =>
      requireSeedUserId([{ id: 'first-user', roles: 'none' }], 'admin'),
    ).toThrow('Missing required seed user with role "admin"');
  });

  it.each([
    {
      missingRoleId: 'admin-role',
      message: 'Missing required Admin seed role',
    },
    {
      missingRoleId: 'organizer-role',
      message: 'Missing required default organizer seed role',
    },
    {
      missingRoleId: 'user-role',
      message: 'Missing required default user seed role',
    },
  ])(
    'rejects an incomplete role graph: $message',
    ({ message, missingRoleId }) => {
      expect(() =>
        requireSeedRoles(roles.filter((role) => role.id !== missingRoleId)),
      ).toThrow(message);
    },
  );

  it('requires exact active VAT rates for paid fixtures', () => {
    const vat7 = {
      active: true,
      percentage: '7',
      stripeTaxRateId: 'txr_vat7',
    };
    const vat19 = {
      active: true,
      percentage: '19',
      stripeTaxRateId: 'txr_vat19',
    };

    expect(
      requireSeedStripeTaxRates([
        {
          active: true,
          percentage: '0',
          stripeTaxRateId: 'txr_zero',
        },
        vat7,
        vat19,
      ]),
    ).toEqual({ vat7, vat19 });
  });

  it.each([
    {
      message:
        'Expected exactly one active 7% Stripe tax rate for paid seed fixtures; found 0',
      rates: [
        {
          active: true,
          percentage: '19',
          stripeTaxRateId: 'txr_vat19',
        },
      ],
    },
    {
      message:
        'Expected exactly one active 19% Stripe tax rate for paid seed fixtures; found 2',
      rates: [
        {
          active: true,
          percentage: '7',
          stripeTaxRateId: 'txr_vat7',
        },
        {
          active: true,
          percentage: '19',
          stripeTaxRateId: 'txr_vat19_a',
        },
        {
          active: true,
          percentage: '19',
          stripeTaxRateId: 'txr_vat19_b',
        },
      ],
    },
  ])(
    'rejects incomplete or ambiguous paid tax fixtures',
    ({ message, rates }) => {
      expect(() => requireSeedStripeTaxRates(rates)).toThrow(message);
    },
  );

  it('rejects a missing declared fixture instead of omitting it', () => {
    expect(() =>
      requireSeedFixture(undefined, 'sports template equipment add-on'),
    ).toThrow(
      'Missing declared seed fixture: sports template equipment add-on',
    );
  });
});
