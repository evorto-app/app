import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { createId } from '../../src/db/create-id';
import { createNodePgPoolConfig } from '../../src/db/pg-connection-config';
import { relations } from '../../src/db/relations';
import { userDiscountCards, users } from '../../src/db/schema';
import { runDatabaseCleanups } from '../../tests/support/utils/database-cleanup';
import { createDiscountCardFixtureLease } from '../../tests/support/utils/discount-card-fixture-lease';
import { captureDiscountCardFixtureSnapshot } from '../../tests/support/utils/discount-card-fixture-snapshot';
import {
  requiredPostgresMajorVersion,
  resolvePostgresIntegrationEnvironment,
} from './postgres-integration-environment';

type LeaseOptions = Omit<
  Parameters<typeof createDiscountCardFixtureLease>[0],
  'databaseUrl' | 'userId'
>;

const createFixture = async () => {
  const environment = await resolvePostgresIntegrationEnvironment({
    environment: {
      ...process.env,
      POSTGRES_INTEGRATION_DATABASE_URL: process.env['DATABASE_URL'],
    },
  });
  const pool = new Pool(
    createNodePgPoolConfig({ databaseUrl: environment.databaseUrl }),
  );
  const database = drizzle({ client: pool, relations });
  const userId = createId();
  const otherUserId = createId();
  const leases: ReturnType<typeof createDiscountCardFixtureLease>[] = [];
  return {
    database,
    otherUserId,
    pool,
    userId,
    createLease: (owner = userId, options: LeaseOptions = {}) => {
      const lease = createDiscountCardFixtureLease({
        databaseUrl: environment.databaseUrl,
        userId: owner,
        acquisitionTimeoutMs: 15_000,
        ...options,
      });
      leases.push(lease);
      return lease;
    },
    close: () =>
      runDatabaseCleanups(
        [
          async () => {
            await database
              .delete(users)
              .where(inArray(users.id, [userId, otherUserId]));
          },
          async () => {
            await database
              .delete(userDiscountCards)
              .where(inArray(userDiscountCards.userId, [userId, otherUserId]));
          },
          ...leases.map((lease) => lease.close),
        ],
        () => pool.end(),
      ),
  };
};

const withFixture = async (
  run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>,
) => {
  const fixture = await createFixture();
  const failures: unknown[] = [];
  try {
    const version = await fixture.pool.query<{ server_version_num: string }>(
      'show server_version_num',
    );
    expect(
      Math.floor(Number(version.rows[0]?.server_version_num) / 10_000),
    ).toBe(requiredPostgresMajorVersion);
    await fixture.database.insert(users).values(
      [fixture.userId, fixture.otherUserId].map((id) => ({
        auth0Id: `fixture-lease|${id}`,
        communicationEmail: `${id}@example.com`,
        email: `${id}@example.com`,
        firstName: 'Fixture',
        id,
        lastName: 'Lease',
      })),
    );
    await run(fixture);
  } catch (error) {
    failures.push(error);
  }
  try {
    await fixture.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Discount-card lease proof failed');
  }
};

const accountLocks = async (
  pool: Pool,
  userId: string,
  scope: 'fixture' | 'product' = 'fixture',
) => {
  const result = await pool.query<{ pid: number; granted: boolean }>(
    `select pid, granted from pg_locks
     where locktype = 'advisory' and objsubid = 1
       and database = (select oid from pg_database where datname = current_database())
       and classid::bigint = ((hashtextextended($1, 0) >> 32) & 4294967295)
       and objid::bigint = (hashtextextended($1, 0) & 4294967295)`,
    [
      scope === 'fixture'
        ? `evorto:test:discount-card-account:${userId}`
        : `evorto:user-discount-cards:${userId}`,
    ],
  );
  return result.rows;
};

describe('shared discount-card fixture account lease', () => {
  it('waits for product pricing readers before replacing the fixture card', async () => {
    await withFixture(async ({ database, createLease, pool, userId }) => {
      const identifier = `original-${userId}`;
      await database.insert(userDiscountCards).values({
        identifier,
        type: 'esnCard',
        userId,
      });
      const owned = await createLease().acquire();
      const snapshot = await captureDiscountCardFixtureSnapshot(owned, userId);
      const changedIdentifier = `changed-${userId}`;
      await owned
        .update(userDiscountCards)
        .set({ identifier: changedIdentifier })
        .where(eq(userDiscountCards.userId, userId));
      const reader = await pool.connect();
      let restoration: Promise<PromiseSettledResult<void>[]> | undefined;
      try {
        await reader.query('begin');
        await reader.query(
          'select pg_advisory_xact_lock_shared(hashtextextended($1, 0))',
          [`evorto:user-discount-cards:${userId}`],
        );
        restoration = Promise.allSettled([snapshot.restore()]);
        await vi.waitFor(
          async () => {
            expect(
              (await accountLocks(pool, userId, 'product')).filter(
                (x) => !x.granted,
              ),
            ).toHaveLength(1);
          },
          { timeout: 10_000 },
        );
        // The writer must wait before taking the card row lock; reversing that
        // order would deadlock this authoritative read against restoration.
        const current = await drizzle({ client: reader, relations })
          .select({ identifier: userDiscountCards.identifier })
          .from(userDiscountCards)
          .where(
            and(
              eq(userDiscountCards.userId, userId),
              eq(userDiscountCards.type, 'esnCard'),
            ),
          )
          .for('key share');
        expect(current).toEqual([{ identifier: changedIdentifier }]);
      } finally {
        try {
          await reader.query('rollback');
        } finally {
          reader.release();
          await restoration;
        }
      }
      expect(await restoration).toMatchObject([{ status: 'fulfilled' }]);
      expect(
        await database.query.userDiscountCards.findFirst({
          where: { userId, type: 'esnCard' },
        }),
      ).toMatchObject({ identifier });
    });
  });

  it('restores the original row before the next owner enters despite another cleanup failure', async () => {
    await withFixture(async ({ database, createLease, pool, userId }) => {
      const identifier = `original-${userId}`;
      await database.insert(userDiscountCards).values({
        identifier,
        type: 'esnCard',
        userId,
      });
      const first = createLease();
      const firstDatabase = await first.acquire();
      const snapshot = await captureDiscountCardFixtureSnapshot(
        firstDatabase,
        userId,
      );
      await firstDatabase
        .update(userDiscountCards)
        .set({ identifier: `changed-${userId}` })
        .where(eq(userDiscountCards.userId, userId));
      const next = createLease();
      const contender = Promise.allSettled([
        next.acquire().then((owned) =>
          owned.query.userDiscountCards.findFirst({
            where: { userId, type: 'esnCard' },
          }),
        ),
      ]);
      await vi.waitFor(
        async () => {
          expect(
            (await accountLocks(pool, userId)).filter((x) => !x.granted),
          ).toHaveLength(1);
        },
        { timeout: 10_000 },
      );

      const restorationStarted = Promise.withResolvers<void>();
      const allowRestoration = Promise.withResolvers<void>();
      const deliberateFailure = new Error('Unrelated fixture cleanup failed');
      const cleanup = Promise.allSettled([
        runDatabaseCleanups(
          [
            first.close,
            async () => {
              restorationStarted.resolve();
              await allowRestoration.promise;
              await snapshot.restore();
            },
            async () => {
              throw deliberateFailure;
            },
          ],
          async () => {},
        ),
      ]);
      try {
        await restorationStarted.promise;
        expect(
          (await accountLocks(pool, userId)).filter((x) => !x.granted),
        ).toHaveLength(1);
      } finally {
        allowRestoration.resolve();
        await Promise.all([cleanup, contender]);
      }
      expect(await cleanup).toMatchObject([
        { status: 'rejected', reason: { errors: [deliberateFailure] } },
      ]);
      expect(await contender).toMatchObject([
        { status: 'fulfilled', value: { identifier } },
      ]);
    });
  });

  it('allows other accounts and product transaction locks without holding an open transaction', async () => {
    await withFixture(async ({ createLease, otherUserId, pool, userId }) => {
      const first = await createLease().acquire();
      await createLease(otherUserId).acquire();
      const product = await pool.query<{ acquired: boolean }>(
        'select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired',
        [`evorto:user-discount-cards:${userId}`],
      );
      expect(product.rows[0]?.acquired).toBe(true);
      const session = await first.$client.query<{ pid: number }>(
        'select pg_backend_pid() as pid',
      );
      const idle = await pool.query<{ xact_start: null | string }>(
        'select xact_start from pg_stat_activity where pid = $1',
        [session.rows[0]?.pid],
      );
      expect(idle.rows).toEqual([{ xact_start: null }]);
    });
  });

  for (const mode of ['abort', 'deadline'] as const) {
    it(`settles a queued acquisition after ${mode} and leaves the account usable`, async () => {
      await withFixture(async ({ createLease, pool, userId }) => {
        const first = createLease();
        await first.acquire();
        const cancellation = new AbortController();
        const queued = createLease(userId, {
          acquisitionTimeoutMs: mode === 'deadline' ? 3_000 : 15_000,
          signal: cancellation.signal,
        });
        let settled = false;
        const pending = Promise.allSettled([queued.acquire()]).then(
          (result) => {
            settled = true;
            return result;
          },
        );
        await vi.waitFor(
          async () => {
            expect(
              (await accountLocks(pool, userId)).filter((x) => !x.granted),
            ).toHaveLength(1);
          },
          { timeout: 10_000 },
        );
        if (mode === 'abort') cancellation.abort();
        await vi.waitFor(() => expect(settled).toBe(true), { timeout: 5_000 });
        expect(await pending).toMatchObject([
          { status: 'rejected', reason: expect.any(Error) },
        ]);
        await queued.close();
        await first.close();
        await createLease().acquire();
        await vi.waitFor(
          async () => {
            expect(await accountLocks(pool, userId)).toMatchObject([
              { granted: true },
            ]);
          },
          { timeout: 10_000 },
        );
      });
    });
  }

  it('cannot restore through a replacement connection after its owned session is lost', async () => {
    await withFixture(async ({ database, createLease, pool, userId }) => {
      await database.insert(userDiscountCards).values({
        identifier: `original-${userId}`,
        type: 'esnCard',
        userId,
      });
      const first = createLease();
      const owned = await first.acquire();
      const snapshot = await captureDiscountCardFixtureSnapshot(owned, userId);
      const backend = await owned.$client.query<{ pid: number }>(
        'select pg_backend_pid() as pid',
      );
      const terminated = await pool.query<{ terminated: boolean }>(
        `select pg_terminate_backend(pid) as terminated from pg_stat_activity
         where pid = $1 and datname = current_database()
           and application_name = 'evorto-discount-card-fixture'`,
        [backend.rows[0]?.pid],
      );
      expect(terminated.rows).toEqual([{ terminated: true }]);
      await first.close();
      await expect(first.acquire()).rejects.toBeInstanceOf(Error);
      const successor = await createLease().acquire();
      const identifier = `successor-${userId}`;
      await successor
        .update(userDiscountCards)
        .set({ identifier })
        .where(eq(userDiscountCards.userId, userId));
      await expect(snapshot.restore()).rejects.toBeInstanceOf(Error);
      expect(
        await database.query.userDiscountCards.findFirst({
          where: { userId, type: 'esnCard' },
        }),
      ).toMatchObject({ identifier });
    });
  });

  it('closes a socket before authentication without waiting for native connect to settle', async () => {
    const peers = new Set<Socket>();
    const startup = Promise.withResolvers<void>();
    const failures: unknown[] = [];
    const server = createServer({ allowHalfOpen: true }, (peer) => {
      peers.add(peer);
      peer.on('data', () => startup.resolve());
      peer.on('error', (error: Error) => {
        if (!('code' in error) || error.code !== 'ECONNRESET')
          failures.push(error);
      });
      peer.once('close', () => peers.delete(peer));
    });
    let lease: ReturnType<typeof createDiscountCardFixtureLease> | undefined;
    const startupDeadline = setTimeout(() => {
      startup.reject(
        new Error('Synthetic PostgreSQL startup was not observed'),
      );
    }, 10_000);
    try {
      const listening = once(server, 'listening');
      server.listen(0, '127.0.0.1');
      await listening;
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Expected TCP');
      lease = createDiscountCardFixtureLease({
        databaseUrl: `postgresql://synthetic:synthetic@127.0.0.1:${address.port}/synthetic?sslmode=disable`,
        userId: 'synthetic-owner',
        acquisitionTimeoutMs: 15_000,
      });
      const pending = Promise.allSettled([lease.acquire()]);
      await startup.promise;
      await lease.close();
      expect(await pending).toMatchObject([
        { status: 'rejected', reason: expect.any(Error) },
      ]);
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(startupDeadline);
      try {
        await lease?.close();
      } catch (error) {
        failures.push(error);
      }
      await Promise.all(
        [...peers].map(
          (peer) =>
            new Promise<void>((resolve) => {
              peer.once('close', () => resolve());
              peer.destroy();
            }),
        ),
      );
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Pre-authentication closure failed');
    }
  });
});
