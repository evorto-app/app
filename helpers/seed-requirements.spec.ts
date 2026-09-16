import { describe, expect, it, vi } from '@effect/vitest';

import { createDatabaseClient } from '../src/db/database-client';
import { setupDatabase } from '../src/db/setup-database';

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

describe('database seed configuration', () => {
  it.each([
    {
      label: 'pinned environment date',
      nowIso: 'not-an-iso-date',
      seedDate: undefined,
      message: 'Invalid E2E_NOW_ISO',
    },
    {
      label: 'supplied Date',
      nowIso: '2026-09-16',
      seedDate: new Date(Number.NaN),
      message: 'Invalid database seed date',
    },
  ])(
    'rejects an invalid $label before a direct setup starts its transaction',
    async ({ nowIso, seedDate, message }) => {
      const { database, pool } = createDatabaseClient(
        'postgresql://fixture:fixture@127.0.0.1:1/unused_seed_fixture',
      );
      // Reject at the transaction boundary if setup regresses, without SQL.
      const transaction = vi
        .spyOn(database, 'transaction')
        .mockRejectedValue(
          new Error('The database transaction must not begin'),
        );
      vi.stubEnv('E2E_NOW_ISO', nowIso);
      try {
        await expect(
          setupDatabase(database, seedDate === undefined ? {} : { seedDate }),
        ).rejects.toThrow(message);
        expect(transaction).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
        transaction.mockRestore();
        await pool.end();
      }
    },
  );
});
