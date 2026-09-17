import { describe, expect, it } from '@effect/vitest';
import { Cause, ConfigProvider, Effect, Exit, Layer } from 'effect';
import { HttpRouter as HttpLayerRouter } from 'effect/unstable/http';

import { EmailDelivery } from '../integrations/email-delivery';
import { APPLICATION_READINESS_PATH } from './application-readiness';
import { workerEmailDeliveryReadinessRouteLayer } from './worker-email-delivery.route';

describe('worker email delivery readiness route', () => {
  for (const { env, reason } of [
    {
      env: {
        APP_ENVIRONMENT: 'production',
        EMAIL_DELIVERY_PROVIDER: 'mailpit',
      },
      reason: 'EMAIL_DELIVERY_PROVIDER must be tem outside local development',
    },
    {
      env: { APP_ENVIRONMENT: 'production', EMAIL_DELIVERY_PROVIDER: 'tem' },
      reason: 'TEM_API_TOKEN and TEM_PROJECT_ID are required for TEM delivery',
    },
    {
      env: {
        APP_ENVIRONMENT: 'staging',
        EMAIL_DELIVERY_PROVIDER: 'tem',
        TEM_API_TOKEN: 'synthetic-token',
        TEM_PROJECT_ID: 'synthetic-project',
      },
      reason:
        'STAGING_EMAIL_ALLOWLIST must contain at least one address in staging',
    },
  ]) {
    it.effect(`refuses to construct readiness when ${reason}`, () =>
      Effect.gen(function* () {
        const appLayer = workerEmailDeliveryReadinessRouteLayer.pipe(
          HttpLayerRouter.provideRequest(EmailDelivery.Default),
          Layer.provide(HttpLayerRouter.layer),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        );
        const exit = yield* Layer.build(appLayer).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.pretty(exit.cause)).toContain(reason);
        }
      }),
    );
  }

  it.effect(
    'reports ready only with the email delivery service available',
    () =>
      Effect.gen(function* () {
        const appLayer = workerEmailDeliveryReadinessRouteLayer.pipe(
          HttpLayerRouter.provideRequest(EmailDelivery.layerFake()),
        );
        const webHandler = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpLayerRouter.toWebHandler(appLayer, { disableLogger: true }),
          ),
          ({ dispose }) => Effect.promise(dispose),
        );

        const response = yield* Effect.promise(() =>
          webHandler.handler(
            new Request(`https://worker.internal${APPLICATION_READINESS_PATH}`),
          ),
        );

        expect(response.status).toBe(204);
        expect(response.headers.get('cache-control')).toBe('no-store');
      }),
  );
});
