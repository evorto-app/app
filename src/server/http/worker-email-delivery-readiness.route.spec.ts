import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { HttpRouter as HttpLayerRouter } from 'effect/unstable/http';

import { EmailDelivery } from '../integrations/email-delivery';
import { APPLICATION_READINESS_PATH } from './application-readiness';
import { workerEmailDeliveryReadinessRouteLayer } from './worker-email-delivery.route';

describe('worker email delivery readiness route', () => {
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
