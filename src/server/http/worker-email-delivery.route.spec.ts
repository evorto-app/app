import { Database } from '@db/index';
import { describe, expect, it, vi } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';
import { HttpRouter as HttpLayerRouter } from 'effect/unstable/http';

import { DeploymentRuntimeConfig } from '../config/deployment-config';
import { EmailDelivery } from '../integrations/email-delivery';
import {
  WORKER_EMAIL_DELIVERY_PATH,
  workerEmailDeliveryRouteLayer,
} from './worker-email-delivery.route';

describe('worker email delivery route', () => {
  it.effect('delivers a due outbox row with request-scoped services', () =>
    Effect.gen(function* () {
      const now = new Date('2026-07-26T10:00:00.000Z');
      const queuedRow = {
        attempts: 0,
        claimLeaseExpiresAt: null,
        claimLeaseId: null,
        createdAt: now,
        exhaustedAt: null,
        fromEmail: 'no-reply@notifications.evorto.app',
        fromName: 'Evorto',
        html: '<p>Hello</p>',
        id: 'email-1',
        idempotencyKey: 'receipt-reviewed/tenant-1/receipt-1/approved',
        kind: 'receiptReviewed' as const,
        lastAttemptAt: null,
        lastError: null,
        maxAttempts: 8,
        nextAttemptAt: now,
        provider: null,
        providerMessageId: null,
        replyToEmail: 'board@example.org',
        replyToName: 'Example Section',
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
        claimLeaseExpiresAt: new Date('2026-07-26T10:10:00.000Z'),
        claimLeaseId: 'lease-1',
        lastAttemptAt: now,
        status: 'sending' as const,
      };
      const deliver = vi.fn(() =>
        Effect.succeed({
          _tag: 'Delivered' as const,
          provider: 'fake' as const,
          providerMessageId: 'fake-email-1',
        }),
      );
      const databaseLayer = Layer.mock(Database)({
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
          set: (values: { status?: string }) => ({
            where: () => ({
              returning: () =>
                Effect.succeed(
                  values.status === 'sending'
                    ? [claimedRow]
                    : [{ id: claimedRow.id }],
                ),
            }),
          }),
        }),
      });
      const deploymentLayer = DeploymentRuntimeConfig.Default.pipe(
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
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
      expect(deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: queuedRow.idempotencyKey,
          to: queuedRow.toEmail,
        }),
      );
    }),
  );
});
