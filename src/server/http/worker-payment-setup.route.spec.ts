import { Database } from '@db/index';
import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';
import { HttpRouter as HttpLayerRouter } from 'effect/unstable/http';
import Stripe from 'stripe';

import { DeploymentRuntimeConfig } from '../config/deployment-config';
import { StripeClient } from '../stripe-client';
import {
  WORKER_PAYMENT_SETUP_PATH,
  workerPaymentSetupRouteLayer,
} from './worker-payment-setup.route';

const paymentSetupRequest = (body: unknown) =>
  new Request(`https://worker.internal${WORKER_PAYMENT_SETUP_PATH}`, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      host: 'worker.internal',
      'x-forwarded-proto': 'https',
    },
    method: 'POST',
  });

const routeLayer = (role: 'web' | 'worker') => {
  const deploymentLayer = DeploymentRuntimeConfig.Default.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            APP_ROLE: role,
            WORKER_TRIGGER_MODE: 'http',
          },
        }),
      ),
    ),
  );
  const requestLayer = Layer.mergeAll(
    Layer.mock(Database)({}),
    deploymentLayer,
    Layer.succeed(StripeClient, new Stripe('sk_test_payment_setup_route')),
  );

  return workerPaymentSetupRouteLayer.pipe(
    HttpLayerRouter.provideRequest(requestLayer),
  );
};

describe('worker payment setup route', () => {
  it.effect(
    'rejects invalid confirmation, unsafe context, and excess arguments',
    () =>
      Effect.gen(function* () {
        const webHandler = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpLayerRouter.toWebHandler(routeLayer('worker'), {
              disableLogger: true,
            }),
          ),
          ({ dispose }) => Effect.promise(dispose),
        );
        const baseInput = {
          accountId: 'acct_payment_setup',
          expectedOrganizationDomain: 'tenant-payment-setup.example',
          organizationId: 'tenant-payment-setup',
          reason: 'Initial payment setup requested by the organization board',
        };

        const wrongConfirmation = yield* Effect.promise(() =>
          webHandler.handler(
            paymentSetupRequest({ ...baseInput, confirmation: 'confirm' }),
          ),
        );
        const excessArgument = yield* Effect.promise(() =>
          webHandler.handler(
            paymentSetupRequest({
              ...baseInput,
              arbitraryCommand: 'ignored-command',
              confirmation: 'attach-payment-account',
            }),
          ),
        );
        const blankReason = yield* Effect.promise(() =>
          webHandler.handler(
            paymentSetupRequest({
              ...baseInput,
              confirmation: 'attach-payment-account',
              reason: ' '.repeat(3),
            }),
          ),
        );
        const leakingReason = yield* Effect.promise(() =>
          webHandler.handler(
            paymentSetupRequest({
              ...baseInput,
              confirmation: 'attach-payment-account',
              reason: `Approved for ${baseInput.accountId}`,
            }),
          ),
        );
        const missingExpectedDomain = yield* Effect.promise(() =>
          webHandler.handler(
            paymentSetupRequest({
              accountId: baseInput.accountId,
              confirmation: 'attach-payment-account',
              organizationId: baseInput.organizationId,
              reason: baseInput.reason,
            }),
          ),
        );

        expect(wrongConfirmation.status).toBe(400);
        expect(excessArgument.status).toBe(400);
        expect(blankReason.status).toBe(400);
        expect(leakingReason.status).toBe(400);
        expect(missingExpectedDomain.status).toBe(400);
        expect(wrongConfirmation.headers.get('cache-control')).toBe('no-store');
        expect(excessArgument.headers.get('cache-control')).toBe('no-store');
        expect(blankReason.headers.get('cache-control')).toBe('no-store');
        expect(leakingReason.headers.get('cache-control')).toBe('no-store');
        expect(missingExpectedDomain.headers.get('cache-control')).toBe(
          'no-store',
        );
      }),
  );

  it.effect('is not mounted for the public web role', () =>
    Effect.gen(function* () {
      const webHandler = yield* Effect.acquireRelease(
        Effect.sync(() =>
          HttpLayerRouter.toWebHandler(routeLayer('web'), {
            disableLogger: true,
          }),
        ),
        ({ dispose }) => Effect.promise(dispose),
      );
      const response = yield* Effect.promise(() =>
        webHandler.handler(
          paymentSetupRequest({
            accountId: 'acct_payment_setup',
            confirmation: 'attach-payment-account',
            expectedOrganizationDomain: 'tenant-payment-setup.example',
            organizationId: 'tenant-payment-setup',
            reason: 'Initial payment setup requested by the organization board',
          }),
        ),
      );

      expect(response.status).toBe(404);
    }),
  );
});
