import { describe, expect, it, vi } from '@effect/vitest';
import { eq, inArray, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import type { EmailDeliveryRequest } from '../integrations/email-delivery';

import { databaseLayer } from '../../db/database.layer';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import { emailOutbox, tenants } from '../../db/schema';
import { EmailDelivery } from '../integrations/email-delivery';
import { processDueEmailOutbox } from './email-delivery';
import {
  emailOutboxAbandonedSendingPredicate,
  emailOutboxDispatchablePredicate,
} from './email-outbox-lease';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

const makeDatabaseServiceLayer = (url: string) =>
  databaseLayer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            DATABASE_TLS_REQUIRED: 'false',
            DATABASE_URL: url,
          },
        }),
      ),
    ),
  );

const acquireOutboxFixture = () =>
  Effect.gen(function* () {
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => new Pool(createNodePgPoolConfig({ databaseUrl }))),
      (acquiredPool) => Effect.promise(() => acquiredPool.end()),
    );
    const database = drizzle({ client: pool, relations });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const tenantId = `mail-${suffix}`;
    const emailIds = {
      expired: `expired-${suffix}`,
      missingExpiry: `missing-exp-${suffix}`,
      missingId: `missing-id-${suffix}`,
      queued: `queued-${suffix}`,
    };
    const ownedIds = Object.values(emailIds);
    // Install ownership before the first write, including unexpected constraint success.
    // ensuring attempts both dependent deletions and preserves either cleanup failure.
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        database.delete(emailOutbox).where(inArray(emailOutbox.id, ownedIds)),
      ).pipe(
        Effect.ensuring(
          Effect.promise(() =>
            database.delete(tenants).where(eq(tenants.id, tenantId)),
          ),
        ),
        Effect.asVoid,
      ),
    );
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
      kind: 'registrationConfirmed',
      subject: 'Registration confirmed',
      tenantId,
      text: 'Hello',
      toEmail: `member-${suffix}@example.org`,
    } satisfies Omit<typeof emailOutbox.$inferInsert, 'idempotencyKey'>;
    return { baseEmail, database, emailIds, ownedIds, tenantId };
  });

const unknownMessage =
  'Evorto could not confirm whether this email was sent. It will not try again automatically, to avoid sending it twice.';

describe('email outbox single-dispatch state transitions', () => {
  it.effect(
    'terminalizes accepted-then-crash ambiguity before dispatching new mail',
    () =>
      Effect.gen(function* () {
        const { baseEmail, database, emailIds, ownedIds, tenantId } =
          yield* acquireOutboxFixture();
        // This global dispatcher proof requires the isolated integration database without
        // an active worker or concurrent outbox producers. Never clean up another test's rows.
        const existingCandidates = yield* Effect.promise(() =>
          database
            .select({ id: emailOutbox.id })
            .from(emailOutbox)
            .where(
              or(
                emailOutboxDispatchablePredicate(),
                emailOutboxAbandonedSendingPredicate(),
              ),
            ),
        );
        expect(
          existingCandidates,
          'Single-dispatch PostgreSQL proof requires an idle, isolated outbox',
        ).toEqual([]);
        yield* Effect.promise(() =>
          database.insert(emailOutbox).values([
            {
              ...baseEmail,
              id: emailIds.queued,
              idempotencyKey: `single-dispatch/${tenantId}/${emailIds.queued}`,
            },
            {
              ...baseEmail,
              attempts: 1,
              claimLeaseExpiresAt: new Date(0),
              claimLeaseId: `lease-${emailIds.expired}`,
              id: emailIds.expired,
              idempotencyKey: `single-dispatch/${tenantId}/${emailIds.expired}`,
              lastAttemptAt: new Date(0),
              status: 'sending',
            },
            {
              ...baseEmail,
              attempts: 1,
              claimLeaseId: `lease-${emailIds.missingExpiry}`,
              id: emailIds.missingExpiry,
              idempotencyKey: `single-dispatch/${tenantId}/${emailIds.missingExpiry}`,
              lastAttemptAt: new Date(0),
              status: 'sending',
            },
            {
              ...baseEmail,
              attempts: 1,
              claimLeaseExpiresAt: new Date(Date.now() + 600_000),
              id: emailIds.missingId,
              idempotencyKey: `single-dispatch/${tenantId}/${emailIds.missingId}`,
              lastAttemptAt: new Date(0),
              status: 'sending',
            },
          ]),
        );
        const deliver = vi.fn((request: EmailDeliveryRequest) =>
          Effect.sync(() => {
            expect(request.to).toBe(baseEmail.toEmail);
            return {
              _tag: 'Delivered',
              provider: 'fake',
              providerMessageId: `fake-${emailIds.queued}`,
            } as const;
          }),
        );
        const deliveryLayer = EmailDelivery.layerFake(deliver);
        const processed = yield* processDueEmailOutbox(10).pipe(
          Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
          Effect.provide(deliveryLayer),
        );
        expect(processed).toBe(1);
        expect(deliver).toHaveBeenCalledOnce();
        const rows = yield* Effect.promise(() =>
          database
            .select()
            .from(emailOutbox)
            .where(inArray(emailOutbox.id, ownedIds)),
        );
        expect(rows).toHaveLength(4);
        expect(rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              attempts: 1,
              claimLeaseExpiresAt: null,
              claimLeaseId: null,
              id: emailIds.queued,
              lastError: null,
              provider: 'fake',
              providerMessageId: `fake-${emailIds.queued}`,
              sentAt: expect.any(Date),
              status: 'sent',
            }),
            ...[
              emailIds.expired,
              emailIds.missingExpiry,
              emailIds.missingId,
            ].map((id) =>
              expect.objectContaining({
                attempts: 1,
                claimLeaseExpiresAt: null,
                claimLeaseId: null,
                deliveryUnknownAt: expect.any(Date),
                id,
                lastError: unknownMessage,
                status: 'deliveryUnknown',
              }),
            ),
          ]),
        );
        expect(
          yield* processDueEmailOutbox(10).pipe(
            Effect.provide(makeDatabaseServiceLayer(databaseUrl)),
            Effect.provide(deliveryLayer),
          ),
        ).toBe(0);
        expect(deliver).toHaveBeenCalledOnce();
      }),
  );

  it.effect('rejects requeueing an already attempted row', () =>
    Effect.gen(function* () {
      const { baseEmail, database, emailIds, tenantId } =
        yield* acquireOutboxFixture();
      yield* Effect.promise(() =>
        database.insert(emailOutbox).values({
          ...baseEmail,
          attempts: 1,
          id: emailIds.queued,
          idempotencyKey: `constraint/${tenantId}`,
          status: 'failed',
        }),
      );
      yield* Effect.promise(() =>
        expect(
          database
            .update(emailOutbox)
            .set({ status: 'queued' })
            .where(eq(emailOutbox.id, emailIds.queued)),
        ).rejects.toMatchObject({
          cause: {
            code: '23514',
            constraint: 'email_outbox_single_dispatch_attempts_check',
          },
        }),
      );
      const rows = yield* Effect.promise(() =>
        database
          .select({
            attempts: emailOutbox.attempts,
            status: emailOutbox.status,
          })
          .from(emailOutbox)
          .where(eq(emailOutbox.id, emailIds.queued)),
      );
      expect(rows).toEqual([{ attempts: 1, status: 'failed' }]);
    }),
  );

  it.effect('rejects a second dispatch attempt for a sent row', () =>
    Effect.gen(function* () {
      const { baseEmail, database, emailIds, tenantId } =
        yield* acquireOutboxFixture();
      yield* Effect.promise(() =>
        database.insert(emailOutbox).values({
          ...baseEmail,
          attempts: 1,
          id: emailIds.queued,
          idempotencyKey: `constraint/${tenantId}`,
          status: 'sent',
        }),
      );
      yield* Effect.promise(() =>
        expect(
          database
            .update(emailOutbox)
            .set({ attempts: 2 })
            .where(eq(emailOutbox.id, emailIds.queued)),
        ).rejects.toMatchObject({
          cause: {
            code: '23514',
            constraint: 'email_outbox_single_dispatch_attempts_check',
          },
        }),
      );
      const rows = yield* Effect.promise(() =>
        database
          .select({
            attempts: emailOutbox.attempts,
            status: emailOutbox.status,
          })
          .from(emailOutbox)
          .where(eq(emailOutbox.id, emailIds.queued)),
      );
      expect(rows).toEqual([{ attempts: 1, status: 'sent' }]);
    }),
  );
});
