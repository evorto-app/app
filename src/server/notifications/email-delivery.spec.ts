import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import { Database } from '@db/index';
import { emailOutbox } from '@db/schema';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import {
  EmailDelivery,
  EmailDeliveryRejectedError,
  EmailDeliveryUnknownError,
} from '@server/integrations/email-delivery';
import { createRegistrationDatabaseTestLayer } from '@server/testing/registration-database';
import { getTableColumns } from 'drizzle-orm';
import { Context, Effect, Exit, Layer } from 'effect';

import { reportPollingWorkerFailure } from '../runtime/polling-worker-supervision';
import {
  enqueueReceiptReviewedEmail,
  enqueueRegistrationCancelledEmail,
  enqueueRegistrationConfirmedEmail,
  enqueueRegistrationTransferredEmail,
  enqueueWaitlistSpotAvailableEmail,
  processDueEmailOutbox,
} from './email-delivery';
const outboxSql = {
  abandoned:
    'update "email_outbox" set "updatedAt" = $1, "claim_lease_expires_at" = $2, "claim_lease_id" = $3, "delivery_unknown_at" = $4, "last_error" = $5, "status" = $6 where "email_outbox"."status" = \'sending\' and ( "email_outbox"."claim_lease_id" is null or "email_outbox"."claim_lease_expires_at" is null or "email_outbox"."claim_lease_expires_at" <= now() ) returning "id"',
  claim:
    'update "email_outbox" set "updatedAt" = $1, "attempts" = $2, "claim_lease_expires_at" = now() + ($3 * interval \'1 millisecond\') , "claim_lease_id" = $4, "last_attempt_at" = now(), "status" = $5 where "email_outbox"."id" = $6 and "email_outbox"."status" = \'queued\' and "email_outbox"."attempts" = 0 returning "createdAt"::text, "id", "updatedAt"::text, "tenantId", "attempts", "claim_lease_expires_at"::text, "claim_lease_id", "delivery_unknown_at"::text, "html", "idempotency_key", "kind", "last_attempt_at"::text, "last_error", "provider", "provider_message_id", "reply_to_email", "reply_to_name", "sent_at"::text, "status", "subject", "suppressed_at"::text, "text", "to_email"',
  failed:
    'update "email_outbox" set "updatedAt" = $1, "claim_lease_expires_at" = $2, "claim_lease_id" = $3, "last_error" = $4, "provider" = $5, "status" = $6 where "email_outbox"."id" = $7 and "email_outbox"."status" = \'sending\' and "email_outbox"."claim_lease_id" = $8 returning "id"',
  insert:
    'insert into "email_outbox" ("createdAt", "id", "updatedAt", "tenantId", "attempts", "claim_lease_expires_at", "claim_lease_id", "delivery_unknown_at", "html", "idempotency_key", "kind", "last_attempt_at", "last_error", "provider", "provider_message_id", "reply_to_email", "reply_to_name", "sent_at", "status", "subject", "suppressed_at", "text", "to_email") values (default, $1, default, $2, default, default, default, default, $3, $4, $5, default, default, default, default, $6, $7, default, default, $8, default, $9, $10) on conflict ("idempotency_key") do nothing',
  select:
    'select "createdAt"::text, "id", "updatedAt"::text, "tenantId", "attempts", "claim_lease_expires_at"::text, "claim_lease_id", "delivery_unknown_at"::text, "html", "idempotency_key", "kind", "last_attempt_at"::text, "last_error", "provider", "provider_message_id", "reply_to_email", "reply_to_name", "sent_at"::text, "status", "subject", "suppressed_at"::text, "text", "to_email" from "email_outbox" where "email_outbox"."status" = \'queued\' and "email_outbox"."attempts" = 0 order by "email_outbox"."createdAt" asc limit $1',
  sent: 'update "email_outbox" set "updatedAt" = $1, "claim_lease_expires_at" = $2, "claim_lease_id" = $3, "last_error" = $4, "provider" = $5, "provider_message_id" = $6, "sent_at" = $7, "status" = $8 where "email_outbox"."id" = $9 and "email_outbox"."status" = \'sending\' and "email_outbox"."claim_lease_id" = $10 returning "id"',
  suppressed:
    'update "email_outbox" set "updatedAt" = $1, "claim_lease_expires_at" = $2, "claim_lease_id" = $3, "last_error" = $4, "provider" = $5, "status" = $6, "suppressed_at" = $7 where "email_outbox"."id" = $8 and "email_outbox"."status" = \'sending\' and "email_outbox"."claim_lease_id" = $9 returning "id"',
  unknown:
    'update "email_outbox" set "updatedAt" = $1, "claim_lease_expires_at" = $2, "claim_lease_id" = $3, "delivery_unknown_at" = $4, "last_error" = $5, "provider" = $6, "status" = $7 where "email_outbox"."id" = $8 and "email_outbox"."status" = \'sending\' and "email_outbox"."claim_lease_id" = $9 returning "id"',
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
const outboxDatabase = ({
  abandonedIds = [],
  claimWins = true,
  queuedRows = [queuedOutboxRow],
  settlement = 'sent',
}: {
  abandonedIds?: readonly string[];
  claimWins?: boolean;
  queuedRows?: readonly OutboxRow[];
  settlement?: 'deliveryUnknown' | 'failed' | 'sent' | 'suppressed';
} = {}) => {
  const updateSets: Partial<OutboxRow>[] = [];
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
      updateSets.push({
        claimLeaseExpiresAt: null,
        claimLeaseId: null,
        deliveryUnknownAt,
        lastError: unknownMessage,
        status: 'deliveryUnknown',
        updatedAt,
      });
      return abandonedIds.map((id) => [id]);
    });
  const readQueued: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      expect(normalizedSql(statement)).toBe(outboxSql.select);
      expect(parameters).toEqual([1]);
      return queuedRows.map((row) => outboxValues(row));
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
      updateSets.push({
        attempts: 1,
        claimLeaseExpiresAt: claimed.claimLeaseExpiresAt,
        claimLeaseId: lease,
        status: 'sending',
      });
      return claimWins ? [outboxValues(claimed)] : [];
    });
  const settleOwned: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      if (!claimLeaseId)
        throw new Error('Settlement without an acquired claim');
      const updatedAt = timestampParameter(parameters[0]);
      const cleared = {
        claimLeaseExpiresAt: null,
        claimLeaseId: null,
        updatedAt,
      };
      switch (settlement) {
        case 'deliveryUnknown': {
          expect(normalizedSql(statement)).toBe(outboxSql.unknown);
          const deliveryUnknownAt = timestampParameter(parameters[3]);
          expect(parameters).toEqual([
            updatedAt.toISOString(),
            null,
            null,
            deliveryUnknownAt.toISOString(),
            unknownMessage,
            'tem',
            'deliveryUnknown',
            queuedOutboxRow.id,
            claimLeaseId,
          ]);
          updateSets.push({
            ...cleared,
            deliveryUnknownAt,
            lastError: unknownMessage,
            provider: 'tem',
            status: 'deliveryUnknown',
          });

          break;
        }
        case 'failed': {
          expect(normalizedSql(statement)).toBe(outboxSql.failed);
          expect(parameters).toEqual([
            updatedAt.toISOString(),
            null,
            null,
            failedMessage,
            'tem',
            'failed',
            queuedOutboxRow.id,
            claimLeaseId,
          ]);
          updateSets.push({
            ...cleared,
            lastError: failedMessage,
            provider: 'tem',
            status: 'failed',
          });

          break;
        }
        case 'sent': {
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
          updateSets.push({
            ...cleared,
            lastError: null,
            provider: 'fake',
            providerMessageId: 'fake-email-1',
            sentAt,
            status: 'sent',
          });

          break;
        }
        default: {
          expect(normalizedSql(statement)).toBe(outboxSql.suppressed);
          const suppressedAt = timestampParameter(parameters[6]);
          expect(parameters).toEqual([
            updatedAt.toISOString(),
            null,
            null,
            suppressedMessage,
            'tem',
            'suppressed',
            suppressedAt.toISOString(),
            queuedOutboxRow.id,
            claimLeaseId,
          ]);
          updateSets.push({
            ...cleared,
            lastError: suppressedMessage,
            provider: 'tem',
            status: 'suppressed',
            suppressedAt,
          });
        }
      }
      return [[queuedOutboxRow.id]];
    });
  const executeValues = vi
    .fn<SqlConnection.Connection['executeValues']>(() =>
      Effect.die(new Error('Unexpected email outbox SQL')),
    )
    .mockImplementationOnce(readAbandoned)
    .mockImplementationOnce(readQueued);
  if (queuedRows.length > 0) {
    expect(queuedRows).toEqual([queuedOutboxRow]);
    executeValues.mockImplementationOnce(claimQueued);
    if (claimWins) executeValues.mockImplementationOnce(settleOwned);
  }
  return {
    databaseLayer: createRegistrationDatabaseTestLayer({ executeValues }),
    executeValues,
    updateSets,
  };
};
const failedMessage =
  'This email could not be sent. Check the recipient address and email settings.';
const unknownMessage =
  'Evorto could not confirm whether this email was sent. It will not send it again, to avoid sending it twice.';
const suppressedMessage =
  'Sending was withheld by the environment recipient policy.';

type CapturedOutboxInsert = Pick<
  OutboxRow,
  | 'html'
  | 'id'
  | 'idempotencyKey'
  | 'kind'
  | 'replyToEmail'
  | 'replyToName'
  | 'subject'
  | 'tenantId'
  | 'text'
  | 'toEmail'
>;
const createEnqueueDatabase = () =>
  Effect.gen(function* () {
    const insertedValues: CapturedOutboxInsert[] = [];
    const executeValues: SqlConnection.Connection['executeValues'] = (
      statement,
      parameters,
    ) =>
      Effect.sync(() => {
        expect(normalizedSql(statement)).toBe(outboxSql.insert);
        expect(parameters).toHaveLength(10);
        const [
          id,
          tenantId,
          html,
          idempotencyKey,
          kind,
          replyToEmail,
          replyToName,
          subject,
          text,
          toEmail,
        ] = parameters;
        if (
          typeof id !== 'string' ||
          typeof tenantId !== 'string' ||
          typeof html !== 'string' ||
          typeof idempotencyKey !== 'string' ||
          typeof subject !== 'string' ||
          typeof text !== 'string' ||
          typeof toEmail !== 'string'
        )
          throw new Error('Expected string email insertion fields');
        if (
          (replyToEmail !== null && typeof replyToEmail !== 'string') ||
          (replyToName !== null && typeof replyToName !== 'string')
        )
          throw new Error('Expected nullable reply-to fields');
        if (
          kind !== 'manualApproval' &&
          kind !== 'receiptReviewed' &&
          kind !== 'registrationCancelled' &&
          kind !== 'registrationConfirmed' &&
          kind !== 'registrationTransferred' &&
          kind !== 'waitlistSpotAvailable'
        )
          throw new Error('Unexpected email kind');
        expect(id).toHaveLength(20);
        insertedValues.push({
          html,
          id,
          idempotencyKey,
          kind,
          replyToEmail,
          replyToName,
          subject,
          tenantId,
          text,
          toEmail,
        });
        return [];
      });
    const database = Context.get(
      yield* Layer.build(
        createRegistrationDatabaseTestLayer({ executeValues }),
      ),
      Database,
    );
    return { database, insertedValues };
  });
describe('email delivery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.effect('preserves scoped worker interruption', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.interrupt.pipe(
          Effect.catchCause(
            reportPollingWorkerFailure('Email outbox processor failed'),
          ),
        ),
      );

      expect(Exit.hasInterrupts(exit)).toBe(true);
    }),
  );

  it.effect(
    'queues receipt review notifications with tenant reply-to and no stored sender copy',
    () =>
      Effect.gen(function* () {
        const { database, insertedValues } = yield* createEnqueueDatabase();

        yield* enqueueReceiptReviewedEmail(database, {
          eventTitle: 'City tour',
          receiptId: 'receipt-1',
          rejectionReason: null,
          status: 'approved',
          tenant: {
            emailSenderEmail: 'board@example.org',
            emailSenderName: 'Example Section',
            id: 'tenant-1',
            name: 'Tenant',
          },
          to: 'alice@example.com',
        });

        expect(insertedValues[0]).toEqual(
          expect.objectContaining({
            idempotencyKey: 'receipt-reviewed/tenant-1/receipt-1/approved',
            kind: 'receiptReviewed',
            replyToEmail: 'board@example.org',
            replyToName: 'Example Section',
            subject: 'Receipt approved',
            tenantId: 'tenant-1',
            toEmail: 'alice@example.com',
          }),
        );
        expect(insertedValues[0]).not.toHaveProperty('fromEmail');
        expect(insertedValues[0]).not.toHaveProperty('fromName');
      }),
  );

  it.effect(
    'renders typed registration lifecycle notifications with stable idempotency keys',
    () =>
      Effect.gen(function* () {
        const { database, insertedValues } = yield* createEnqueueDatabase();
        const tenant = {
          emailSenderEmail: 'board@example.org',
          emailSenderName: 'Example Section',
          id: 'tenant-1',
          name: 'Example Section',
        };
        const eventTitle = 'City tour <script>alert(1)</script>';
        const eventUrl = 'https://app.example/events/event-1';

        yield* enqueueRegistrationConfirmedEmail(database, {
          eventTitle,
          registrationId: 'registration-1',
          tenant,
          ticketUrl: eventUrl,
          to: 'alice@example.com',
        });
        yield* enqueueRegistrationConfirmedEmail(database, {
          eventTitle,
          registrationId: 'registration-1',
          tenant,
          ticketUrl: eventUrl,
          to: 'alice@example.com',
        });
        yield* enqueueRegistrationCancelledEmail(database, {
          cancelledBy: 'organizer',
          eventTitle,
          eventUrl,
          registrationId: 'registration-1',
          tenant,
          to: 'alice@example.com',
        });
        yield* enqueueWaitlistSpotAvailableEmail(database, {
          availabilityKey: 'cancellation-registration-1',
          eventTitle,
          eventUrl,
          tenant,
          to: 'waitlist@example.com',
          waitlistRegistrationId: 'waitlist-1',
        });
        yield* enqueueRegistrationTransferredEmail(database, {
          eventTitle,
          eventUrl,
          recipientRole: 'newOwner',
          recipientUserId: 'user-2',
          registrationId: 'registration-1',
          tenant,
          to: 'new-owner@example.com',
          transferOperationId: 'direct-registration-transfer:acquisition-1',
        });
        yield* enqueueRegistrationTransferredEmail(database, {
          eventTitle,
          eventUrl,
          recipientRole: 'newOwner',
          recipientUserId: 'user-2',
          registrationId: 'registration-1',
          tenant,
          to: 'new-owner@example.com',
          transferOperationId: 'direct-registration-transfer:acquisition-1',
        });
        yield* enqueueRegistrationTransferredEmail(database, {
          eventTitle,
          eventUrl,
          recipientRole: 'previousOwner',
          recipientUserId: 'user-1',
          registrationId: 'registration-1',
          tenant,
          to: 'previous-owner@example.com',
          transferOperationId: 'direct-registration-transfer:acquisition-1',
        });
        yield* enqueueRegistrationTransferredEmail(database, {
          eventTitle,
          eventUrl,
          recipientRole: 'newOwner',
          recipientUserId: 'user-2',
          registrationId: 'registration-1',
          tenant,
          to: 'new-owner@example.com',
          transferOperationId: 'direct-registration-transfer:acquisition-2',
        });

        expect(insertedValues.map((value) => value.idempotencyKey)).toEqual([
          'registration-confirmed/tenant-1/registration-1',
          'registration-confirmed/tenant-1/registration-1',
          'registration-cancelled/tenant-1/registration-1',
          'waitlist-spot-available/tenant-1/waitlist-1/cancellation-registration-1',
          'registration-transferred/tenant-1/registration-1/direct-registration-transfer:acquisition-1/newOwner/user-2',
          'registration-transferred/tenant-1/registration-1/direct-registration-transfer:acquisition-1/newOwner/user-2',
          'registration-transferred/tenant-1/registration-1/direct-registration-transfer:acquisition-1/previousOwner/user-1',
          'registration-transferred/tenant-1/registration-1/direct-registration-transfer:acquisition-2/newOwner/user-2',
        ]);
        expect(insertedValues.map((value) => value.kind)).toEqual([
          'registrationConfirmed',
          'registrationConfirmed',
          'registrationCancelled',
          'waitlistSpotAvailable',
          'registrationTransferred',
          'registrationTransferred',
          'registrationTransferred',
          'registrationTransferred',
        ]);
        for (const insertedValue of insertedValues) {
          expect(insertedValue.html).toEqual(
            expect.stringContaining('lang="en"'),
          );
          expect(insertedValue.html).toEqual(expect.stringContaining('<h1'));
          expect(insertedValue.html).not.toEqual(
            expect.stringContaining('<script>alert(1)</script>'),
          );
          expect(insertedValue.html).not.toEqual(
            expect.stringContaining('https://app.esn.world'),
          );
          expect(insertedValue.text).toEqual(expect.any(String));
          expect(String(insertedValue.text).length).toBeGreaterThan(20);
        }
        expect(insertedValues[0]?.text).toContain(
          'The ticket owner must sign in to Evorto',
        );
        expect(insertedValues[3]?.text).toContain('does not reserve a spot');
      }),
  );

  it.effect(
    'keeps cancellation idempotency stable while rendering the exact cancellation actor',
    () =>
      Effect.gen(function* () {
        const { database, insertedValues } = yield* createEnqueueDatabase();
        const baseInput = {
          eventTitle: 'City tour',
          eventUrl: 'https://app.example/events/event-1',
          registrationId: 'registration-1',
          tenant: {
            emailSenderEmail: 'board@example.org',
            emailSenderName: 'Example Section',
            id: 'tenant-1',
            name: 'Example Section',
          },
          to: 'alice@example.com',
        };

        yield* enqueueRegistrationCancelledEmail(database, {
          ...baseInput,
          cancelledBy: 'participant',
        });
        yield* enqueueRegistrationCancelledEmail(database, {
          ...baseInput,
          cancelledBy: 'organizer',
        });
        yield* enqueueRegistrationCancelledEmail(database, {
          ...baseInput,
          cancelledBy: 'platformAdministrator',
        });

        expect(insertedValues.map((value) => value.idempotencyKey)).toEqual([
          'registration-cancelled/tenant-1/registration-1',
          'registration-cancelled/tenant-1/registration-1',
          'registration-cancelled/tenant-1/registration-1',
        ]);
        expect(String(insertedValues[0]?.text)).toContain(
          'You cancelled your registration for City tour.',
        );
        expect(String(insertedValues[1]?.text)).toContain(
          'An organizer cancelled your registration for City tour.',
        );
        expect(String(insertedValues[2]?.text)).toContain(
          'A platform administrator cancelled your registration for City tour.',
        );
        expect(String(insertedValues[2]?.text)).not.toContain(
          'An organizer cancelled',
        );
      }),
  );

  it.effect('sends a newly queued outbox row once with its reply-to', () =>
    Effect.gen(function* () {
      const deliverMock = vi.fn(() =>
        Effect.succeed({
          _tag: 'Delivered' as const,
          provider: 'fake' as const,
          providerMessageId: 'fake-email-1',
        }),
      );
      const { databaseLayer, executeValues, updateSets } = outboxDatabase();

      const processed = yield* processDueEmailOutbox(1).pipe(
        Effect.provide(databaseLayer),
        Effect.provide(EmailDelivery.layerFake(deliverMock)),
      );

      expect(processed).toBe(1);
      expect(executeValues).toHaveBeenCalledTimes(4);
      expect(deliverMock).toHaveBeenCalledOnce();
      expect(deliverMock).toHaveBeenCalledWith({
        html: '<p>Hello</p>',
        replyTo: {
          email: 'board@example.org',
          name: 'Example Section',
        },
        subject: 'Receipt approved',
        text: 'Hello',
        to: 'alice@example.com',
      });
      expect(updateSets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ attempts: 1, status: 'sending' }),
          expect.objectContaining({
            claimLeaseExpiresAt: null,
            claimLeaseId: null,
            provider: 'fake',
            providerMessageId: 'fake-email-1',
            status: 'sent',
          }),
        ]),
      );
    }),
  );

  it.effect(
    'marks missing and expired sending claims unknown without dispatching again',
    () =>
      Effect.gen(function* () {
        const deliverMock = vi.fn(() =>
          Effect.succeed({
            _tag: 'Delivered' as const,
            provider: 'fake' as const,
            providerMessageId: 'must-not-send',
          }),
        );
        const { databaseLayer, executeValues, updateSets } = outboxDatabase({
          abandonedIds: ['expired-claim', 'missing-lease', 'missing-claim-id'],
          queuedRows: [],
        });

        const processed = yield* processDueEmailOutbox(1).pipe(
          Effect.provide(databaseLayer),
          Effect.provide(EmailDelivery.layerFake(deliverMock)),
        );

        expect(processed).toBe(0);
        expect(executeValues).toHaveBeenCalledTimes(2);
        expect(deliverMock).not.toHaveBeenCalled();
        expect(updateSets).toEqual([
          expect.objectContaining({
            claimLeaseExpiresAt: null,
            claimLeaseId: null,
            deliveryUnknownAt: expect.any(Date),
            lastError:
              'Evorto could not confirm whether this email was sent. It will not send it again, to avoid sending it twice.',
            status: 'deliveryUnknown',
          }),
        ]);
      }),
  );

  it.effect('skips delivery when another worker wins the atomic claim', () =>
    Effect.gen(function* () {
      const deliverMock = vi.fn(() =>
        Effect.succeed({
          _tag: 'Delivered' as const,
          provider: 'fake' as const,
          providerMessageId: 'unexpected',
        }),
      );
      const { databaseLayer, executeValues } = outboxDatabase({
        claimWins: false,
      });

      const processed = yield* processDueEmailOutbox(1).pipe(
        Effect.provide(databaseLayer),
        Effect.provide(EmailDelivery.layerFake(deliverMock)),
      );

      expect(processed).toBe(0);
      expect(executeValues).toHaveBeenCalledTimes(3);
      expect(deliverMock).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    'keeps an ambiguous provider outcome terminal and never requeues',
    () =>
      Effect.gen(function* () {
        const deliveryLayer = EmailDelivery.layerFake(() =>
          Effect.fail(
            new EmailDeliveryUnknownError({
              message:
                'tem email request failed with HTTP 503; delivery outcome is unknown',
              provider: 'tem',
            }),
          ),
        );
        const { databaseLayer, executeValues, updateSets } = outboxDatabase({
          settlement: 'deliveryUnknown',
        });

        const processed = yield* processDueEmailOutbox(1).pipe(
          Effect.provide(databaseLayer),
          Effect.provide(deliveryLayer),
        );

        expect(processed).toBe(1);
        expect(executeValues).toHaveBeenCalledTimes(4);
        expect(updateSets.at(-1)).toEqual(
          expect.objectContaining({
            claimLeaseExpiresAt: null,
            claimLeaseId: null,
            deliveryUnknownAt: expect.any(Date),
            lastError:
              'Evorto could not confirm whether this email was sent. It will not send it again, to avoid sending it twice.',
            provider: 'tem',
            status: 'deliveryUnknown',
          }),
        );
        expect(JSON.stringify(updateSets)).not.toContain('HTTP 503');
        expect(updateSets).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ status: 'queued' }),
          ]),
        );
      }),
  );

  it.effect('stores an explicit provider rejection as a terminal failure', () =>
    Effect.gen(function* () {
      const deliveryLayer = EmailDelivery.layerFake(() =>
        Effect.fail(
          new EmailDeliveryRejectedError({
            message: 'tem email request failed with HTTP 400',
            provider: 'tem',
          }),
        ),
      );
      const { databaseLayer, executeValues, updateSets } = outboxDatabase({
        settlement: 'failed',
      });

      const processed = yield* processDueEmailOutbox(1).pipe(
        Effect.provide(databaseLayer),
        Effect.provide(deliveryLayer),
      );

      expect(processed).toBe(1);
      expect(executeValues).toHaveBeenCalledTimes(4);
      expect(updateSets.at(-1)).toEqual(
        expect.objectContaining({
          claimLeaseExpiresAt: null,
          claimLeaseId: null,
          lastError:
            'This email could not be sent. Check the recipient address and email settings.',
          provider: 'tem',
          status: 'failed',
        }),
      );
      expect(JSON.stringify(updateSets)).not.toContain('HTTP 400');
      expect(updateSets).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ status: 'queued' })]),
      );
    }),
  );

  it.effect('stores a plain explanation when an email is withheld', () =>
    Effect.gen(function* () {
      const deliveryLayer = EmailDelivery.layerFake(() =>
        Effect.succeed({
          _tag: 'Suppressed' as const,
          provider: 'tem' as const,
          reason: 'Recipient is outside the protected staging allowlist',
        }),
      );
      const { databaseLayer, executeValues, updateSets } = outboxDatabase({
        settlement: 'suppressed',
      });

      const processed = yield* processDueEmailOutbox(1).pipe(
        Effect.provide(databaseLayer),
        Effect.provide(deliveryLayer),
      );

      expect(processed).toBe(1);
      expect(executeValues).toHaveBeenCalledTimes(4);
      expect(updateSets.at(-1)).toEqual(
        expect.objectContaining({
          claimLeaseExpiresAt: null,
          claimLeaseId: null,
          lastError:
            'Sending was withheld by the environment recipient policy.',
          provider: 'tem',
          status: 'suppressed',
          suppressedAt: expect.any(Date),
        }),
      );
      expect(JSON.stringify(updateSets)).not.toContain('allowlist');
    }),
  );
});
