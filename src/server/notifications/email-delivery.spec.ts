import { Database } from '@db/index';
import { emailOutbox } from '@db/schema';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';

import {
  enqueueReceiptReviewedEmail,
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

        yield* enqueueReceiptReviewedEmail(database as never, {
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

  it.effect('sends due outbox rows through Resend with reply-to', () =>
    Effect.gen(function* () {
      const now = new Date('2026-07-09T10:00:00.000Z');
      const queuedRow = {
        attempts: 0,
        createdAt: now,
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
              where: () =>
                values.status === 'sending'
                  ? {
                      returning: () => Effect.succeed([claimedRow]),
                    }
                  : Effect.void,
            };
          },
        }),
      };

      const processed = yield* processDueEmailOutbox(1).pipe(
        Effect.provide(Layer.succeed(Database, database as never)),
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
            resendEmailId: 'resend-email-1',
            status: 'sent',
          }),
        ]),
      );
    }),
  );
});
