import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import { emailOutbox } from '@db/schema';
import { describe, expect, it, vi } from '@effect/vitest';
import { createRegistrationDatabaseTestLayer } from '@server/testing/registration-database';
import { getTableColumns } from 'drizzle-orm';
import { ConfigProvider, Effect, Layer } from 'effect';
import { HttpRouter as HttpLayerRouter } from 'effect/unstable/http';

import { DeploymentRuntimeConfig } from '../config/deployment-config';
import { EmailDelivery } from '../integrations/email-delivery';
import {
  WORKER_EMAIL_DELIVERY_PATH,
  workerEmailDeliveryRouteLayer,
} from './worker-email-delivery.route';

const outboxSql = {
  abandoned:
    'update "email_outbox" set "updatedAt" = $1, "claim_lease_expires_at" = $2, "claim_lease_id" = $3, "delivery_unknown_at" = $4, "last_error" = $5, "status" = $6 where "email_outbox"."status" = \'sending\' and ( "email_outbox"."claim_lease_id" is null or "email_outbox"."claim_lease_expires_at" is null or "email_outbox"."claim_lease_expires_at" <= now() ) returning "id"',
  claim:
    'update "email_outbox" set "updatedAt" = $1, "attempts" = $2, "claim_lease_expires_at" = now() + ($3 * interval \'1 millisecond\') , "claim_lease_id" = $4, "last_attempt_at" = now(), "status" = $5 where "email_outbox"."id" = $6 and "email_outbox"."status" = \'queued\' and "email_outbox"."attempts" = 0 returning "createdAt"::text, "id", "updatedAt"::text, "tenantId", "attempts", "claim_lease_expires_at"::text, "claim_lease_id", "delivery_unknown_at"::text, "html", "idempotency_key", "kind", "last_attempt_at"::text, "last_error", "provider", "provider_message_id", "reply_to_email", "reply_to_name", "sent_at"::text, "status", "subject", "suppressed_at"::text, "text", "to_email"',
  select:
    'select "createdAt"::text, "id", "updatedAt"::text, "tenantId", "attempts", "claim_lease_expires_at"::text, "claim_lease_id", "delivery_unknown_at"::text, "html", "idempotency_key", "kind", "last_attempt_at"::text, "last_error", "provider", "provider_message_id", "reply_to_email", "reply_to_name", "sent_at"::text, "status", "subject", "suppressed_at"::text, "text", "to_email" from "email_outbox" where "email_outbox"."status" = \'queued\' and "email_outbox"."attempts" = 0 order by "email_outbox"."createdAt" asc limit $1',
  sent: 'update "email_outbox" set "updatedAt" = $1, "claim_lease_expires_at" = $2, "claim_lease_id" = $3, "last_error" = $4, "provider" = $5, "provider_message_id" = $6, "sent_at" = $7, "status" = $8 where "email_outbox"."id" = $9 and "email_outbox"."status" = \'sending\' and "email_outbox"."claim_lease_id" = $10 returning "id"',
};
type OutboxRow = typeof emailOutbox.$inferSelect;
const outboxNow = new Date('2026-07-09T10:00:00.000Z');
const queuedOutboxRow: OutboxRow = {
  attempts: 0,
  claimLeaseExpiresAt: null,
  claimLeaseId: null,
  createdAt: outboxNow,
  deliveryUnknownAt: null,
  html: '<p>Hello</p>',
  id: 'email-1',
  idempotencyKey: 'receipt-reviewed/tenant-1/receipt-1/approved',
  kind: 'receiptReviewed',
  lastAttemptAt: null,
  lastError: null,
  provider: null,
  providerMessageId: null,
  replyToEmail: 'board@example.org',
  replyToName: 'Example Section',
  sentAt: null,
  status: 'queued',
  subject: 'Receipt approved',
  suppressedAt: null,
  tenantId: 'tenant-1',
  text: 'Hello',
  toEmail: 'alice@example.com',
  updatedAt: outboxNow,
};
const normalizedSql = (statement: string) =>
  statement.replaceAll(/\s+/g, ' ').trim();
const timestampParameter = (value: unknown) => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new TypeError('Expected a serialized timestamp parameter');
  }
  return new Date(value);
};
const outboxValues = (row: OutboxRow) => {
  const values: Record<string, Date | null | number | string> = row;
  return Object.keys(getTableColumns(emailOutbox)).map((key) => {
    const value = values[key];
    if (value === undefined)
      throw new Error(`Missing email outbox column ${key}`);
    return value instanceof Date ? value.toISOString().replace('Z', '') : value;
  });
};
const outboxDatabase = () => {
  let claimLeaseId: string | undefined;
  const readAbandoned: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      expect(normalizedSql(statement)).toBe(outboxSql.abandoned);
      const updatedAt = timestampParameter(parameters[0]);
      const deliveryUnknownAt = timestampParameter(parameters[3]);
      expect(parameters).toEqual([
        updatedAt.toISOString(),
        null,
        null,
        deliveryUnknownAt.toISOString(),
        unknownMessage,
        'deliveryUnknown',
      ]);
      return [];
    });
  const readQueued: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      expect(normalizedSql(statement)).toBe(outboxSql.select);
      expect(parameters).toEqual([1]);
      return [outboxValues(queuedOutboxRow)];
    });
  const claimQueued: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      expect(normalizedSql(statement)).toBe(outboxSql.claim);
      const updatedAt = timestampParameter(parameters[0]);
      const lease = parameters[3];
      if (typeof lease !== 'string')
        throw new Error('Expected generated claim lease ID');
      expect(lease).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(parameters).toEqual([
        updatedAt.toISOString(),
        1,
        600_000,
        lease,
        'sending',
        queuedOutboxRow.id,
      ]);
      claimLeaseId = lease;
      const claimed: OutboxRow = {
        ...queuedOutboxRow,
        attempts: 1,
        claimLeaseExpiresAt: new Date(outboxNow.getTime() + 600_000),
        claimLeaseId: lease,
        lastAttemptAt: outboxNow,
        status: 'sending',
        updatedAt,
      };
      return [outboxValues(claimed)];
    });
  const settleOwned: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      if (!claimLeaseId)
        throw new Error('Settlement without an acquired claim');
      const updatedAt = timestampParameter(parameters[0]);
      expect(normalizedSql(statement)).toBe(outboxSql.sent);
      const sentAt = timestampParameter(parameters[6]);
      expect(parameters).toEqual([
        updatedAt.toISOString(),
        null,
        null,
        null,
        'fake',
        'fake-email-1',
        sentAt.toISOString(),
        'sent',
        queuedOutboxRow.id,
        claimLeaseId,
      ]);
      return [[queuedOutboxRow.id]];
    });
  const executeValues = vi
    .fn<SqlConnection.Connection['executeValues']>(() =>
      Effect.die(new Error('Unexpected email outbox SQL')),
    )
    .mockImplementationOnce(readAbandoned)
    .mockImplementationOnce(readQueued)
    .mockImplementationOnce(claimQueued)
    .mockImplementationOnce(settleOwned);
  return {
    databaseLayer: createRegistrationDatabaseTestLayer({ executeValues }),
    executeValues,
  };
};
const unknownMessage =
  'Evorto could not confirm whether this email was sent. It will not send it again, to avoid sending it twice.';

describe('worker email delivery route', () => {
  it.effect('delivers a due outbox row with request-scoped services', () =>
    Effect.gen(function* () {
      const deliver = vi.fn(() =>
        Effect.succeed({
          _tag: 'Delivered' as const,
          provider: 'fake' as const,
          providerMessageId: 'fake-email-1',
        }),
      );
      const { databaseLayer, executeValues } = outboxDatabase();
      const deploymentLayer = DeploymentRuntimeConfig.Default.pipe(
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                APP_ENVIRONMENT: 'local',
                APP_ROLE: 'worker',
                WORKER_TRIGGER_MODE: 'http',
              },
            }),
          ),
        ),
      );
      const requestLayer = Layer.mergeAll(
        databaseLayer,
        deploymentLayer,
        EmailDelivery.layerFake(deliver),
      );
      const appLayer = workerEmailDeliveryRouteLayer.pipe(
        HttpLayerRouter.provideRequest(requestLayer),
      );
      const webHandler = yield* Effect.acquireRelease(
        Effect.sync(() =>
          HttpLayerRouter.toWebHandler(appLayer, { disableLogger: true }),
        ),
        ({ dispose }) => Effect.promise(dispose),
      );

      const response = yield* Effect.promise(() =>
        webHandler.handler(
          new Request(`https://worker.internal${WORKER_EMAIL_DELIVERY_PATH}`, {
            body: JSON.stringify({ limit: 1 }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
          }),
        ),
      );

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toEqual({
        processed: 1,
      });
      expect(deliver).toHaveBeenCalledOnce();
      expect(executeValues).toHaveBeenCalledTimes(4);
      expect(deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          replyTo: { email: 'board@example.org', name: 'Example Section' },
          to: queuedOutboxRow.toEmail,
        }),
      );
    }),
  );
});
