import { randNumber, seed } from '@ngneat/falso';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as generatedIds from '../src/db/create-id';
import { createDatabaseClient } from '../src/db/database-client';
import { addFinanceReceipts } from './add-finance-receipts';
import * as seedIds from './get-id';
import { usersToAuthenticate } from './user-data';

const originalUsers = [...usersToAuthenticate];

afterEach(() => {
  usersToAuthenticate.splice(0, usersToAuthenticate.length, ...originalUsers);
  vi.restoreAllMocks();
});

describe('finance receipt seed prerequisites', () => {
  it.each([
    { eventIds: [], missingRole: 'all', expectedError: null },
    {
      eventIds: ['event-1'],
      missingRole: 'user',
      expectedError: 'Missing required seed user with role "user"',
    },
    {
      eventIds: ['event-1'],
      missingRole: 'admin',
      expectedError: 'Missing required seed user with role "admin"',
    },
  ])(
    'handles missing $missingRole users with events $eventIds before seed side effects',
    async ({ eventIds, expectedError, missingRole }) => {
      usersToAuthenticate.splice(
        0,
        usersToAuthenticate.length,
        ...originalUsers.filter(
          (user) => missingRole !== 'all' && user.roles !== missingRole,
        ),
      );
      const { database, pool } = createDatabaseClient(
        'postgresql://fixture:fixture@127.0.0.1:1/unused_receipt_fixture',
      );
      const insert = vi.spyOn(database, 'insert').mockImplementation(() => {
        throw new Error('Receipt prerequisites must not insert rows');
      });
      const createId = vi.spyOn(generatedIds, 'createId');
      const getId = vi.spyOn(seedIds, 'getId');
      seed('receipt-prerequisite-random-state');
      const expectedNextRandomValues = randNumber({ length: 3 });
      seed('receipt-prerequisite-random-state');

      try {
        const result = addFinanceReceipts(database, {
          currency: 'EUR',
          eventIds,
          tenantId: 'tenant-1',
        });
        if (expectedError === null) {
          await expect(result).resolves.toBeUndefined();
        } else {
          await expect(result).rejects.toThrow(expectedError);
        }

        expect(insert).not.toHaveBeenCalled();
        expect(createId).not.toHaveBeenCalled();
        expect(getId).not.toHaveBeenCalled();
        expect(randNumber({ length: 3 })).toEqual(expectedNextRandomValues);
      } finally {
        await pool.end();
      }
    },
  );
});
