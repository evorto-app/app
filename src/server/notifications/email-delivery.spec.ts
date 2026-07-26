import type { DatabaseClient } from '@db/index';

import { Database } from '@db/index';
import { emailOutbox } from '@db/schema';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import {
  EmailDelivery,
  EmailDeliveryRejectedError,
  EmailDeliveryUnknownError,
} from '@server/integrations/email-delivery';
import { Effect, Exit, Layer } from 'effect';

import {
  enqueueManualApprovalEmail,
  enqueueReceiptReviewedEmail,
  enqueueRegistrationCancelledEmail,
  enqueueRegistrationConfirmedEmail,
  enqueueRegistrationTransferredEmail,
  enqueueWaitlistSpotAvailableEmail,
  handleEmailOutboxProcessorCause,
  InvalidTenantEmailTimezoneError,
  processDueEmailOutbox,
} from './email-delivery';

const outboxNow = new Date('2026-07-09T10:00:00.000Z');

const queuedOutboxRow = {
  attempts: 0,
  claimLeaseExpiresAt: null,
  claimLeaseId: null,
  createdAt: outboxNow,
  deliveryUnknownAt: null,
  html: '<p>Hello</p>',
  id: 'email-1',
  idempotencyKey: 'receipt-reviewed/tenant-1/receipt-1/approved',
  kind: 'receiptReviewed' as const,
  lastAttemptAt: null,
  lastError: null,
  provider: null,
  providerMessageId: null,
  replyToEmail: 'board@example.org',
  replyToName: 'Example Section',
  sentAt: null,
  status: 'queued' as const,
  subject: 'Receipt approved',
  suppressedAt: null,
  tenantId: 'tenant-1',
  text: 'Hello',
  toEmail: 'alice@example.com',
  updatedAt: outboxNow,
};

const claimedOutboxRow = {
  ...queuedOutboxRow,
  attempts: 1,
  claimLeaseExpiresAt: new Date('2026-07-09T10:10:00.000Z'),
  claimLeaseId: 'lease-1',
  lastAttemptAt: outboxNow,
  status: 'sending' as const,
};

const outboxDatabase = ({
  abandonedIds = [],
  claimWins = true,
  queuedRows = [queuedOutboxRow],
}: {
  abandonedIds?: readonly string[];
  claimWins?: boolean;
  queuedRows?: readonly (typeof queuedOutboxRow)[];
} = {}) => {
  const updateSets: Record<string, unknown>[] = [];
  const database = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Effect.succeed(queuedRows),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSets.push(values);
        return {
          where: () => ({
            returning: () => {
              if (
                values.status === 'deliveryUnknown' &&
                String(values.lastError).startsWith(
                  'The delivery worker stopped',
                )
              ) {
                return Effect.succeed(abandonedIds.map((id) => ({ id })));
              }
              if (values.status === 'sending') {
                return Effect.succeed(claimWins ? [claimedOutboxRow] : []);
              }
              return Effect.succeed([{ id: claimedOutboxRow.id }]);
            },
          }),
        };
      },
    }),
  };
  return { database, updateSets };
};

describe('email delivery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.effect('preserves scoped worker interruption', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.interrupt.pipe(
          Effect.catchCause(handleEmailOutboxProcessorCause),
        ),
      );

      expect(Exit.hasInterrupts(exit)).toBe(true);
    }),
  );

  it.effect(
    'queues receipt review notifications with a tenant reply-to and no stored sender copy',
    () =>
      Effect.gen(function* () {
        let insertedValue: unknown;
        const database = {
          insert: (table: unknown) => {
            expect(table).toBe(emailOutbox);
            return {
              values: (value: unknown) => {
                insertedValue = value;
                return {
                  onConflictDoNothing: (options: unknown) => {
                    expect(options).toEqual({
                      target: emailOutbox.idempotencyKey,
                    });
                    return Effect.void;
                  },
                };
              },
            };
          },
        };

        yield* enqueueReceiptReviewedEmail(
          database as Pick<DatabaseClient, 'insert'>,
          {
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
          },
        );

        expect(insertedValue).toEqual(
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
        expect(insertedValue).not.toHaveProperty('fromEmail');
        expect(insertedValue).not.toHaveProperty('fromName');
      }),
  );

  it.effect(
    'formats a paid manual approval deadline in the authoritative tenant timezone',
    () =>
      Effect.gen(function* () {
        let insertedValue: Record<string, unknown> | undefined;
        const database = {
          insert: () => ({
            values: (value: Record<string, unknown>) => {
              insertedValue = value;
              return {
                onConflictDoNothing: () => Effect.void,
              };
            },
          }),
        } as Pick<DatabaseClient, 'insert'>;

        yield* enqueueManualApprovalEmail(database, {
          approvalKey: 'transaction-1',
          eventTitle: 'City tour',
          eventUrl: 'https://section.example.org/events/event-1',
          paymentDeadline: new Date('2026-07-15T14:30:00.000Z'),
          registrationId: 'registration-1',
          tenant: {
            emailSenderEmail: 'board@example.org',
            emailSenderName: 'Example Section',
            id: 'tenant-1',
            name: 'Example Section',
            timezone: 'Australia/Brisbane',
          },
          to: 'alice@example.com',
        });

        expect(String(insertedValue?.text)).toContain(
          '16.07.2026, 00:30 GMT+10 (Australia/Brisbane)',
        );
        expect(String(insertedValue?.text)).not.toContain(
          '2026-07-15T14:30:00.000Z',
        );
      }),
  );

  it.effect(
    'fails with a typed error when a persisted tenant timezone is invalid',
    () =>
      Effect.gen(function* () {
        const insert = vi.fn();
        const error = yield* enqueueManualApprovalEmail(
          { insert } as Pick<DatabaseClient, 'insert'>,
          {
            approvalKey: 'transaction-1',
            eventTitle: 'City tour',
            eventUrl: 'https://section.example.org/events/event-1',
            paymentDeadline: new Date('2026-07-15T14:30:00.000Z'),
            registrationId: 'registration-1',
            tenant: {
              emailSenderEmail: 'board@example.org',
              emailSenderName: 'Example Section',
              id: 'tenant-1',
              name: 'Example Section',
              timezone: 'Invalid/Timezone',
            },
            to: 'alice@example.com',
          },
        ).pipe(Effect.flip);

        expect(error).toBeInstanceOf(InvalidTenantEmailTimezoneError);
        expect(error).toMatchObject({
          _tag: 'InvalidTenantEmailTimezoneError',
          tenantId: 'tenant-1',
          timezone: 'Invalid/Timezone',
        });
        expect(insert).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'renders typed registration lifecycle notifications with stable idempotency keys',
    () =>
      Effect.gen(function* () {
        const insertedValues: Record<string, unknown>[] = [];
        const database = {
          insert: (table: unknown) => {
            expect(table).toBe(emailOutbox);
            return {
              values: (value: Record<string, unknown>) => {
                insertedValues.push(value);
                return {
                  onConflictDoNothing: (options: unknown) => {
                    expect(options).toEqual({
                      target: emailOutbox.idempotencyKey,
                    });
                    return Effect.void;
                  },
                };
              },
            };
          },
        } as Pick<DatabaseClient, 'insert'>;
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
        const insertedValues: Record<string, unknown>[] = [];
        const database = {
          insert: (table: unknown) => {
            expect(table).toBe(emailOutbox);
            return {
              values: (value: Record<string, unknown>) => {
                insertedValues.push(value);
                return {
                  onConflictDoNothing: (options: unknown) => {
                    expect(options).toEqual({
                      target: emailOutbox.idempotencyKey,
                    });
                    return Effect.void;
                  },
                };
              },
            };
          },
        } as Pick<DatabaseClient, 'insert'>;
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
      const { database, updateSets } = outboxDatabase();

      const processed = yield* processDueEmailOutbox(1).pipe(
        Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
        Effect.provide(EmailDelivery.layerFake(deliverMock)),
      );

      expect(processed).toBe(1);
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
        const { database, updateSets } = outboxDatabase({
          abandonedIds: ['expired-claim', 'missing-lease'],
          queuedRows: [],
        });

        const processed = yield* processDueEmailOutbox(1).pipe(
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
          Effect.provide(EmailDelivery.layerFake(deliverMock)),
        );

        expect(processed).toBe(0);
        expect(deliverMock).not.toHaveBeenCalled();
        expect(updateSets).toEqual([
          expect.objectContaining({
            claimLeaseExpiresAt: null,
            claimLeaseId: null,
            deliveryUnknownAt: expect.any(Date),
            lastError: expect.stringContaining(
              'automatic resend is disabled to prevent duplicate email',
            ),
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
      const { database } = outboxDatabase({ claimWins: false });

      const processed = yield* processDueEmailOutbox(1).pipe(
        Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
        Effect.provide(EmailDelivery.layerFake(deliverMock)),
      );

      expect(processed).toBe(0);
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
        const { database, updateSets } = outboxDatabase();

        const processed = yield* processDueEmailOutbox(1).pipe(
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
          Effect.provide(deliveryLayer),
        );

        expect(processed).toBe(1);
        expect(updateSets.at(-1)).toEqual(
          expect.objectContaining({
            claimLeaseExpiresAt: null,
            claimLeaseId: null,
            deliveryUnknownAt: expect.any(Date),
            lastError:
              'tem email request failed with HTTP 503; delivery outcome is unknown',
            provider: 'tem',
            status: 'deliveryUnknown',
          }),
        );
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
      const { database, updateSets } = outboxDatabase();

      const processed = yield* processDueEmailOutbox(1).pipe(
        Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
        Effect.provide(deliveryLayer),
      );

      expect(processed).toBe(1);
      expect(updateSets.at(-1)).toEqual(
        expect.objectContaining({
          claimLeaseExpiresAt: null,
          claimLeaseId: null,
          lastError: 'tem email request failed with HTTP 400',
          provider: 'tem',
          status: 'failed',
        }),
      );
      expect(updateSets).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ status: 'queued' })]),
      );
    }),
  );
});
