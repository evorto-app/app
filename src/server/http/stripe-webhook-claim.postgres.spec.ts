import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigProvider, Effect, Layer } from 'effect';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { databaseLayer } from '../../db/database.layer';
import { createNodePgPoolConfig } from '../../db/pg-connection-config';
import { relations } from '../../db/relations';
import { stripeWebhookEvents } from '../../db/schema';
import {
  claimWebhookEvent,
  markWebhookEventProcessed,
  releaseWebhookEventClaim,
} from './stripe-webhook.web-handler';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}
const serviceLayer = databaseLayer.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: { DATABASE_TLS_REQUIRED: 'false', DATABASE_URL: databaseUrl },
      }),
    ),
  ),
);

const claimEvent = (eventId: string) =>
  Effect.gen(function* () {
    const result = yield* claimWebhookEvent({
      eventId,
      eventType: 'checkout.session.completed',
    });
    if (result.type !== 'claimed') {
      return yield* Effect.die(new Error(`Expected claim, got ${result.type}`));
    }
    return result.claim;
  });

describe('Stripe webhook claim ownership', () => {
  let database: NodePgDatabase<typeof relations>;
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool(createNodePgPoolConfig({ databaseUrl }));
    database = drizzle({ client: pool, relations });
  });
  afterAll(async () => {
    await pool.end();
  });

  for (const lateOutcome of ['failure', 'success'] as const) {
    it(`preserves a recovered claim when its former owner reports late ${lateOutcome}`, async () => {
      const eventId = `evt_test_${randomUUID()}`;
      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const original = yield* claimEvent(eventId);
            // Make the handler eligible for takeover without waiting five minutes.
            yield* Effect.promise(() =>
              database
                .update(stripeWebhookEvents)
                .set({ processedAt: new Date(Date.now() - 6 * 60_000) })
                .where(eq(stripeWebhookEvents.stripeEventId, eventId)),
            );
            const recovered = yield* claimEvent(eventId);
            expect(recovered.claimId).not.toBe(original.claimId);

            yield* lateOutcome === 'failure'
              ? releaseWebhookEventClaim(original)
              : markWebhookEventProcessed(original);
            expect(
              yield* claimWebhookEvent({
                eventId,
                eventType: 'checkout.session.completed',
              }),
            ).toEqual({ type: 'duplicate-processing' });

            // Only the recovered owner may finish processing the event.
            yield* markWebhookEventProcessed(recovered);
            yield* releaseWebhookEventClaim(original);
            expect(
              yield* claimWebhookEvent({
                eventId,
                eventType: 'checkout.session.completed',
              }),
            ).toEqual({ type: 'duplicate-processed' });
          }).pipe(Effect.provide(serviceLayer)),
        );
      } finally {
        await database
          .delete(stripeWebhookEvents)
          .where(eq(stripeWebhookEvents.stripeEventId, eventId));
      }
    });
  }

  it('releases a failed current claim and preserves its replacement even at the same timestamp', async () => {
    const eventId = `evt_test_${randomUUID()}`;
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const original = yield* claimEvent(eventId);
          const [row] = yield* Effect.promise(() =>
            database
              .select()
              .from(stripeWebhookEvents)
              .where(eq(stripeWebhookEvents.stripeEventId, eventId)),
          );
          if (!row)
            return yield* Effect.die(new Error('Expected stored claim'));
          yield* releaseWebhookEventClaim(original);
          const replacement = yield* claimEvent(eventId);
          yield* Effect.promise(() =>
            database
              .update(stripeWebhookEvents)
              .set({ processedAt: row.processedAt })
              .where(eq(stripeWebhookEvents.stripeEventId, eventId)),
          );
          expect(replacement.claimId).not.toBe(original.claimId);
          yield* releaseWebhookEventClaim(original);
          yield* markWebhookEventProcessed(original);
          expect(
            yield* claimWebhookEvent({
              eventId,
              eventType: 'checkout.session.completed',
            }),
          ).toEqual({ type: 'duplicate-processing' });
          yield* markWebhookEventProcessed(replacement);
          // A completed receipt must remain deduplicated, even for its own owner.
          yield* releaseWebhookEventClaim(replacement);
          expect(
            yield* claimWebhookEvent({
              eventId,
              eventType: 'checkout.session.completed',
            }),
          ).toEqual({ type: 'duplicate-processed' });
        }).pipe(Effect.provide(serviceLayer)),
      );
    } finally {
      await database
        .delete(stripeWebhookEvents)
        .where(eq(stripeWebhookEvents.stripeEventId, eventId));
    }
  });
});
