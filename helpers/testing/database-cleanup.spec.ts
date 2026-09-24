import { afterEach, describe, expect, it, vi } from 'vitest';

import { observeCleanupProgress } from '../../tests/support/utils/cleanup-progress';
import { runDatabaseCleanups } from '../../tests/support/utils/database-cleanup';

describe('database fixture cleanup lifetime', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps the database open until every registered cleanup finishes', async () => {
    vi.useFakeTimers();
    const diagnostic = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
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

    await vi.advanceTimersByTimeAsync(9_999);
    expect(diagnostic).not.toHaveBeenCalled();
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(diagnostic.mock.calls).toEqual([
      ['[test cleanup] registered fixture callback still pending after 10s\n'],
    ]);
    expect(closed).toBe(false);
    cleanupGate.resolve();
    await completion;
    expect(order).toEqual(['close page', 'restore rows', 'close database']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs remaining cleanup and closes the database while retaining every failure', async () => {
    vi.useFakeTimers();
    const diagnostic = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
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
    await expect(
      observeCleanupProgress('database pool closure', async () => {
        throw closeFailure;
      }),
    ).rejects.toBe(closeFailure);
    expect(diagnostic).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes an unused database without inventing cleanup work', async () => {
    vi.useFakeTimers();
    const diagnostic = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    let closes = 0;
    await runDatabaseCleanups([], async () => {
      closes += 1;
    });
    expect(closes).toBe(1);
    const result = { closed: true };
    await expect(
      observeCleanupProgress('database pool closure', async () => result),
    ).resolves.toBe(result);
    expect(diagnostic).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
