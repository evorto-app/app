import { afterAll, beforeAll, describe, expect, it, vi } from '@effect/vitest';
import { inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { databaseLayer } from '../../db/database.layer';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import { emailOutbox, tenants } from '../../db/schema';
import { EmailDelivery } from '../integrations/email-delivery';
import { processDueEmailOutbox } from './email-delivery';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

type TestDatabase = NodePgDatabase<typeof relations>;

const makeDatabaseServiceLayer = (url: string) =>
  databaseLayer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: Object.fromEntries([['DATABASE_URL', url]]),
        }),
      ),
    ),
  );

describe('email outbox single-dispatch state transitions', () => {
  let database: TestDatabase;
  let pool: Pool;
  const emailIds: string[] = [];
  const tenantIds: string[] = [];

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });

  afterAll(async () => {
    await database.delete(emailOutbox).where(inArray(emailOutbox.id, emailIds));
    await database.delete(tenants).where(inArray(tenants.id, tenantIds));
    await pool.end();
  });

  it.effect(
    'terminalizes accepted-then-crash ambiguity before dispatching new mail',
    () =>
      Effect.gen(function* () {
        const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
        const tenantId = `mail-${suffix}`.slice(0, 20);
        const queuedId = `queued-${suffix}`.slice(0, 20);
        const expiredId = `expired-${suffix}`.slice(0, 20);
        const missingLeaseId = `missing-${suffix}`.slice(0, 20);
        tenantIds.push(tenantId);
        emailIds.push(queuedId, expiredId, missingLeaseId);

        yield* Effect.promise(() =>
          database.insert(tenants).values({
            currency: 'EUR',
            domain: `${suffix}.mail-outbox.example`,
            id: tenantId,
            name: `Mail outbox ${suffix}`,
          }),
        );
        const baseEmail = {
          html: '<p>Hello</p>',
          kind: 'registrationConfirmed' as const,
          subject: 'Registration confirmed',
          tenantId,
          text: 'Hello',
          toEmail: `member-${suffix}@example.org`,
        };
        yield* Effect.promise(() =>
          database.insert(emailOutbox).values([
            {
              ...baseEmail,
              id: queuedId,
              idempotencyKey: `single-dispatch/${tenantId}/${queuedId}`,
            },
            {
              ...baseEmail,
              attempts: 1,
              claimLeaseExpiresAt: new Date(0),
              claimLeaseId: `lease-${expiredId}`,
              id: expiredId,
              idempotencyKey: `single-dispatch/${tenantId}/${expiredId}`,
              lastAttemptAt: new Date(0),
              status: 'sending',
            },
            {
              ...baseEmail,
              attempts: 1,
              id: missingLeaseId,
              idempotencyKey: `single-dispatch/${tenantId}/${missingLeaseId}`,
              lastAttemptAt: new Date(0),
              status: 'sending',
            },
          ]),
        );

        const deliver = vi.fn(() =>
          Effect.succeed({
            _tag: 'Delivered' as const,
            provider: 'fake' as const,
            providerMessageId: `fake-${queuedId}`,
          }),
        );
        const processed = yield* processDueEmailOutbox(10).pipe(
          Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
          Effect.provide(EmailDelivery.layerFake(deliver)),
        );

        expect(processed).toBe(1);
        expect(deliver).toHaveBeenCalledOnce();
        const rows = yield* Effect.promise(() =>
          database
            .select({
              attempts: emailOutbox.attempts,
              id: emailOutbox.id,
              lastError: emailOutbox.lastError,
              status: emailOutbox.status,
            })
            .from(emailOutbox)
            .where(inArray(emailOutbox.id, emailIds)),
        );
        expect(rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              attempts: 1,
              id: queuedId,
              status: 'sent',
            }),
            expect.objectContaining({
              attempts: 1,
              id: expiredId,
              lastError:
                'Evorto could not confirm whether this email was sent. It will not try again automatically, to avoid sending it twice.',
              status: 'deliveryUnknown',
            }),
            expect.objectContaining({
              attempts: 1,
              id: missingLeaseId,
              lastError:
                'Evorto could not confirm whether this email was sent. It will not try again automatically, to avoid sending it twice.',
              status: 'deliveryUnknown',
            }),
          ]),
        );
      }),
  );
});
