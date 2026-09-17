import { describe, expect, it } from 'vitest';

import { runDatabaseCleanups } from '../../tests/support/utils/database-cleanup';

describe('database fixture cleanup lifetime', () => {
  it('keeps the database open until every registered cleanup finishes', async () => {
    const cleanupGate = Promise.withResolvers<void>();
    const order: string[] = [];
    let closed = false;
    const completion = runDatabaseCleanups(
      [
        async () => {
          expect(closed).toBe(false);
          order.push('restore rows');
        },
        async () => {
          await cleanupGate.promise;
          expect(closed).toBe(false);
          order.push('close page');
        },
      ],
      async () => {
        closed = true;
        order.push('close database');
      },
    );

    await Promise.resolve();
    expect(closed).toBe(false);
    cleanupGate.resolve();
    await completion;
    expect(order).toEqual(['close page', 'restore rows', 'close database']);
  });

  it('runs remaining cleanup and closes the database while retaining every failure', async () => {
    const rowFailure = new Error('row restoration failed');
    const pageFailure = new Error('page cleanup failed');
    const closeFailure = new Error('database close failed');
    const order: string[] = [];

    await expect(
      runDatabaseCleanups(
        [
          async () => {
            order.push('rows');
            throw rowFailure;
          },
          async () => {
            order.push('page');
            throw pageFailure;
          },
        ],
        async () => {
          order.push('database');
          throw closeFailure;
        },
      ),
    ).rejects.toMatchObject({
      errors: [pageFailure, rowFailure, closeFailure],
      message: 'Database test cleanup failed',
    });
    expect(order).toEqual(['page', 'rows', 'database']);
  });

  it('closes an unused database without inventing cleanup work', async () => {
    let closes = 0;
    await runDatabaseCleanups([], async () => {
      closes += 1;
    });
    expect(closes).toBe(1);
  });
});
