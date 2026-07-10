import type { DatabaseClient } from '@db/index';

import { Database } from '@db/index';
import { emailOutbox } from '@db/schema';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';

import {
  enqueueReceiptReviewedEmail,
  enqueueRegistrationCancelledEmail,
  enqueueRegistrationConfirmedEmail,
  enqueueRegistrationTransferredEmail,
  enqueueWaitlistSpotAvailableEmail,
  processDueEmailOutbox,
} from './email-delivery';

const emailConfigProviderLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: {
      RESEND_API_KEY: 're_test_123',
    },
  }),
);

describe('email delivery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.effect(
    'queues receipt review notifications with fixed from and tenant reply-to',
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
            fromEmail: 'no-reply@notifications.esn.world',
            fromName: 'ESN.WORLD',
            idempotencyKey: 'receipt-reviewed/tenant-1/receipt-1/approved',
            kind: 'receiptReviewed',
            replyToEmail: 'board@example.org',
            replyToName: 'Example Section',
            subject: 'Receipt approved',
            tenantId: 'tenant-1',
            toEmail: 'alice@example.com',
          }),
        );
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
        });
        yield* enqueueRegistrationTransferredEmail(database, {
          eventTitle,
          eventUrl,
          recipientRole: 'previousOwner',
          recipientUserId: 'user-1',
          registrationId: 'registration-1',
          tenant,
          to: 'previous-owner@example.com',
        });

        expect(insertedValues.map((value) => value.idempotencyKey)).toEqual([
          'registration-confirmed/tenant-1/registration-1',
          'registration-confirmed/tenant-1/registration-1',
          'registration-cancelled/tenant-1/registration-1',
          'waitlist-spot-available/tenant-1/waitlist-1/cancellation-registration-1',
          'registration-transferred/tenant-1/registration-1/newOwner/user-2',
          'registration-transferred/tenant-1/registration-1/previousOwner/user-1',
        ]);
        expect(insertedValues.map((value) => value.kind)).toEqual([
          'registrationConfirmed',
          'registrationConfirmed',
          'registrationCancelled',
          'waitlistSpotAvailable',
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
        expect(insertedValues[0]?.text).toContain('not a bearer credential');
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

  it.effect('sends due outbox rows through Resend with reply-to', () =>
    Effect.gen(function* () {
      const now = new Date('2026-07-09T10:00:00.000Z');
      const queuedRow = {
        attempts: 0,
        claimLeaseExpiresAt: null,
        claimLeaseId: null,
        createdAt: now,
        exhaustedAt: null,
        fromEmail: 'no-reply@notifications.esn.world',
        fromName: 'ESN.WORLD',
        html: '<p>Hello</p>',
        id: 'email-1',
        idempotencyKey: 'receipt-reviewed/tenant-1/receipt-1/approved',
        kind: 'receiptReviewed' as const,
        lastAttemptAt: null,
        lastError: null,
        maxAttempts: 8,
        nextAttemptAt: now,
        replyToEmail: 'board@example.org',
        replyToName: 'Example Section',
        resendEmailId: null,
        sentAt: null,
        status: 'queued' as const,
        subject: 'Receipt approved',
        tenantId: 'tenant-1',
        text: 'Hello',
        toEmail: 'alice@example.com',
        updatedAt: now,
      };
      const claimedRow = {
        ...queuedRow,
        attempts: 1,
        claimLeaseExpiresAt: new Date('2026-07-09T10:10:00.000Z'),
        claimLeaseId: 'lease-1',
        lastAttemptAt: now,
        status: 'sending' as const,
      };
      const fetchMock = vi.fn(async () =>
        Response.json({ id: 'resend-email-1' }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const updateSets: unknown[] = [];
      const database = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => Effect.succeed([queuedRow]),
              }),
            }),
          }),
        }),
        update: () => ({
          set: (values: { status?: string }) => {
            updateSets.push(values);
            return {
              where: () => ({
                returning: () =>
                  Effect.succeed(
                    values.status === 'sending'
                      ? [claimedRow]
                      : [{ id: claimedRow.id }],
                  ),
              }),
            };
          },
        }),
      };

      const processed = yield* processDueEmailOutbox(1).pipe(
        Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
        Effect.provide(emailConfigProviderLayer),
      );

      expect(processed).toBe(1);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [, init] = fetchMock.mock.calls[0] ?? [];
      expect(init).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer re_test_123',
            'Content-Type': 'application/json',
            'Idempotency-Key': 'receipt-reviewed/tenant-1/receipt-1/approved',
          }),
          method: 'POST',
        }),
      );
      expect(JSON.parse(String(init?.body))).toEqual(
        expect.objectContaining({
          from: 'ESN.WORLD <no-reply@notifications.esn.world>',
          reply_to: 'Example Section <board@example.org>',
          subject: 'Receipt approved',
          to: 'alice@example.com',
        }),
      );
      expect(updateSets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'sending' }),
          expect.objectContaining({
            claimLeaseExpiresAt: null,
            claimLeaseId: null,
            resendEmailId: 'resend-email-1',
            status: 'sent',
          }),
        ]),
      );
    }),
  );

  it.effect(
    'reclaims an expired sending lease without consuming another attempt',
    () =>
      Effect.gen(function* () {
        const now = new Date('2026-07-09T10:20:00.000Z');
        const staleRow = {
          attempts: 8,
          claimLeaseExpiresAt: new Date('2026-07-09T10:10:00.000Z'),
          claimLeaseId: 'abandoned-lease',
          createdAt: now,
          exhaustedAt: null,
          fromEmail: 'no-reply@notifications.esn.world',
          fromName: 'ESN.WORLD',
          html: '<p>Hello</p>',
          id: 'email-stale',
          idempotencyKey: 'manual-approval/tenant-1/registration-1/confirmed',
          kind: 'manualApproval' as const,
          lastAttemptAt: new Date('2026-07-09T10:00:00.000Z'),
          lastError: null,
          maxAttempts: 8,
          nextAttemptAt: new Date('2026-07-09T10:00:00.000Z'),
          replyToEmail: null,
          replyToName: null,
          resendEmailId: null,
          sentAt: null,
          status: 'sending' as const,
          subject: 'Registration approved',
          tenantId: 'tenant-1',
          text: 'Hello',
          toEmail: 'alice@example.com',
          updatedAt: new Date('2026-07-09T10:00:00.000Z'),
        };
        const reclaimedRow = {
          ...staleRow,
          claimLeaseExpiresAt: new Date('2026-07-09T10:30:00.000Z'),
          claimLeaseId: 'replacement-lease',
          lastAttemptAt: now,
        };
        const fetchMock = vi.fn(async () =>
          Response.json({ id: 'resend-email-stale' }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const updateSets: {
          claimLeaseExpiresAt?: unknown;
          claimLeaseId?: null | string;
          status?: string;
        }[] = [];
        const database = {
          select: () => ({
            from: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => Effect.succeed([staleRow]),
                }),
              }),
            }),
          }),
          update: () => ({
            set: (values: {
              claimLeaseExpiresAt?: unknown;
              claimLeaseId?: null | string;
              status?: string;
            }) => {
              updateSets.push(values);
              return {
                where: () => ({
                  returning: () =>
                    Effect.succeed(
                      values.status === 'sending'
                        ? [reclaimedRow]
                        : [{ id: staleRow.id }],
                    ),
                }),
              };
            },
          }),
        };

        const processed = yield* processDueEmailOutbox(1).pipe(
          Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
          Effect.provide(emailConfigProviderLayer),
        );

        expect(processed).toBe(1);
        expect(fetchMock).toHaveBeenCalledOnce();
        const [, init] = fetchMock.mock.calls[0] ?? [];
        expect(init?.headers).toEqual(
          expect.objectContaining({
            'Idempotency-Key':
              'manual-approval/tenant-1/registration-1/confirmed',
          }),
        );
        expect(reclaimedRow.attempts).toBe(8);
        expect(updateSets).toEqual([
          expect.objectContaining({
            claimLeaseExpiresAt: expect.anything(),
            claimLeaseId: expect.any(String),
            status: 'sending',
          }),
          expect.objectContaining({
            claimLeaseExpiresAt: null,
            claimLeaseId: null,
            status: 'sent',
          }),
        ]);
      }),
  );

  it.effect('skips delivery when another worker wins the atomic claim', () =>
    Effect.gen(function* () {
      const now = new Date('2026-07-09T10:20:00.000Z');
      const staleRow = {
        attempts: 1,
        claimLeaseExpiresAt: new Date('2026-07-09T10:10:00.000Z'),
        claimLeaseId: 'abandoned-lease',
        createdAt: now,
        exhaustedAt: null,
        fromEmail: 'no-reply@notifications.esn.world',
        fromName: 'ESN.WORLD',
        html: '<p>Hello</p>',
        id: 'email-stale',
        idempotencyKey: 'receipt-reviewed/tenant-1/receipt-1/approved',
        kind: 'receiptReviewed' as const,
        lastAttemptAt: now,
        lastError: null,
        maxAttempts: 8,
        nextAttemptAt: now,
        replyToEmail: null,
        replyToName: null,
        resendEmailId: null,
        sentAt: null,
        status: 'sending' as const,
        subject: 'Receipt approved',
        tenantId: 'tenant-1',
        text: 'Hello',
        toEmail: 'alice@example.com',
        updatedAt: now,
      };
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const database = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => Effect.succeed([staleRow]),
              }),
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              returning: () => Effect.succeed([]),
            }),
          }),
        }),
      };

      const processed = yield* processDueEmailOutbox(1).pipe(
        Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
        Effect.provide(emailConfigProviderLayer),
      );

      expect(processed).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    }),
  );

  it.effect('requeues retryable outbox failures with backoff metadata', () =>
    Effect.gen(function* () {
      const now = new Date('2026-07-09T10:00:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const queuedRow = {
        attempts: 0,
        claimLeaseExpiresAt: null,
        claimLeaseId: null,
        createdAt: now,
        exhaustedAt: null,
        fromEmail: 'no-reply@notifications.esn.world',
        fromName: 'ESN.WORLD',
        html: '<p>Hello</p>',
        id: 'email-1',
        idempotencyKey: 'receipt-reviewed/tenant-1/receipt-1/approved',
        kind: 'receiptReviewed' as const,
        lastAttemptAt: null,
        lastError: null,
        maxAttempts: 8,
        nextAttemptAt: now,
        replyToEmail: null,
        replyToName: null,
        resendEmailId: null,
        sentAt: null,
        status: 'queued' as const,
        subject: 'Receipt approved',
        tenantId: 'tenant-1',
        text: 'Hello',
        toEmail: 'alice@example.com',
        updatedAt: now,
      };
      const claimedRow = {
        ...queuedRow,
        attempts: 1,
        claimLeaseExpiresAt: new Date('2026-07-09T10:10:00.000Z'),
        claimLeaseId: 'lease-1',
        lastAttemptAt: now,
        status: 'sending' as const,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status: 500 })),
      );
      const updateSets: unknown[] = [];
      const database = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => Effect.succeed([queuedRow]),
              }),
            }),
          }),
        }),
        update: () => ({
          set: (values: { status?: string }) => {
            updateSets.push(values);
            return {
              where: () => ({
                returning: () =>
                  Effect.succeed(
                    values.status === 'sending'
                      ? [claimedRow]
                      : [{ id: claimedRow.id }],
                  ),
              }),
            };
          },
        }),
      };

      const processed = yield* processDueEmailOutbox(1).pipe(
        Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
        Effect.provide(emailConfigProviderLayer),
      );

      expect(processed).toBe(1);
      expect(updateSets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'sending' }),
          expect.objectContaining({
            claimLeaseExpiresAt: null,
            claimLeaseId: null,
            exhaustedAt: null,
            lastError: 'Resend email request failed: 500',
            nextAttemptAt: new Date('2026-07-09T10:00:01.000Z'),
            status: 'queued',
          }),
        ]),
      );
    }),
  );

  it.effect('marks non-retryable outbox failures as exhausted', () =>
    Effect.gen(function* () {
      const now = new Date('2026-07-09T10:00:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const queuedRow = {
        attempts: 0,
        claimLeaseExpiresAt: null,
        claimLeaseId: null,
        createdAt: now,
        exhaustedAt: null,
        fromEmail: 'no-reply@notifications.esn.world',
        fromName: 'ESN.WORLD',
        html: '<p>Hello</p>',
        id: 'email-1',
        idempotencyKey: 'receipt-reviewed/tenant-1/receipt-1/approved',
        kind: 'receiptReviewed' as const,
        lastAttemptAt: null,
        lastError: null,
        maxAttempts: 8,
        nextAttemptAt: now,
        replyToEmail: null,
        replyToName: null,
        resendEmailId: null,
        sentAt: null,
        status: 'queued' as const,
        subject: 'Receipt approved',
        tenantId: 'tenant-1',
        text: 'Hello',
        toEmail: 'alice@example.com',
        updatedAt: now,
      };
      const claimedRow = {
        ...queuedRow,
        attempts: 1,
        claimLeaseExpiresAt: new Date('2026-07-09T10:10:00.000Z'),
        claimLeaseId: 'lease-1',
        lastAttemptAt: now,
        status: 'sending' as const,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status: 400 })),
      );
      const updateSets: unknown[] = [];
      const database = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => Effect.succeed([queuedRow]),
              }),
            }),
          }),
        }),
        update: () => ({
          set: (values: { status?: string }) => {
            updateSets.push(values);
            return {
              where: () => ({
                returning: () =>
                  Effect.succeed(
                    values.status === 'sending'
                      ? [claimedRow]
                      : [{ id: claimedRow.id }],
                  ),
              }),
            };
          },
        }),
      };

      const processed = yield* processDueEmailOutbox(1).pipe(
        Effect.provide(Layer.succeed(Database, database as DatabaseClient)),
        Effect.provide(emailConfigProviderLayer),
      );

      expect(processed).toBe(1);
      expect(updateSets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'sending' }),
          expect.objectContaining({
            claimLeaseExpiresAt: null,
            claimLeaseId: null,
            exhaustedAt: now,
            lastError: 'Resend email request failed: 400',
            nextAttemptAt: now,
            status: 'failed',
          }),
        ]),
      );
    }),
  );
});
