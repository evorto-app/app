import { Effect, Schema } from 'effect';
import {
  HttpRouter as HttpLayerRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';

import { DeploymentRuntimeConfig } from '../config/deployment-config';
import { EmailDelivery } from '../integrations/email-delivery';
import { processDueEmailOutbox } from '../notifications/email-delivery';
import { validateRuntimeRoleConfiguration } from '../runtime/runtime-role';
import { APPLICATION_READINESS_PATH } from './application-readiness';
import {
  handleInternalJsonTriggerWebRequest,
  InternalTriggerArguments,
} from './internal-trigger.web-handler';

export const WORKER_EMAIL_DELIVERY_PATH =
  '/internal/worker/email-delivery' as const;

export const workerEmailDeliveryReadinessRouteLayer = HttpLayerRouter.add(
  'GET',
  APPLICATION_READINESS_PATH,
  () =>
    EmailDelivery.use(() =>
      Effect.succeed(
        HttpServerResponse.empty({
          headers: { 'Cache-Control': 'no-store' },
          status: 204,
        }),
      ),
    ),
);

export const handleWorkerTrigger = <A, E, R>(
  request: HttpServerRequest.HttpServerRequest,
  operation: (arguments_: InternalTriggerArguments) => Effect.Effect<A, E, R>,
) => handleWorkerJsonTrigger(request, InternalTriggerArguments, operation);

export const handleWorkerJsonTrigger = <S extends Schema.Constraint, A, E, R>(
  request: HttpServerRequest.HttpServerRequest,
  schema: S,
  operation: (arguments_: S['Type']) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const deployment = yield* DeploymentRuntimeConfig;
    const runtimeRole = yield* validateRuntimeRoleConfiguration(deployment);
    if (runtimeRole.role !== 'worker' || runtimeRole.triggerMode !== 'http') {
      return yield* Effect.fail(new HttpServerError.RouteNotFound({ request }));
    }

    const webRequest = yield* HttpServerRequest.toWeb(request);
    const webResponse = yield* handleInternalJsonTriggerWebRequest(
      webRequest,
      schema,
      operation,
    );
    return HttpServerResponse.fromWeb(webResponse);
  });

export const workerEmailDeliveryRouteLayer = HttpLayerRouter.add(
  'POST',
  WORKER_EMAIL_DELIVERY_PATH,
  (request) =>
    handleWorkerTrigger(request, ({ limit }) =>
      processDueEmailOutbox(limit ?? 10).pipe(
        Effect.map((processed) => ({ processed })),
      ),
    ),
);
