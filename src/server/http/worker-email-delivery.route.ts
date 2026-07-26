import { Effect } from 'effect';
import {
  HttpRouter as HttpLayerRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';

import { DeploymentRuntimeConfig } from '../config/deployment-config';
import { processDueEmailOutbox } from '../notifications/email-delivery';
import { validateRuntimeRoleConfiguration } from '../runtime/runtime-role';
import {
  handleInternalTriggerWebRequest,
  type InternalTriggerArguments,
} from './internal-trigger.web-handler';

export const WORKER_EMAIL_DELIVERY_PATH =
  '/internal/worker/email-delivery' as const;

export const handleWorkerTrigger = <A, E, R>(
  request: HttpServerRequest.HttpServerRequest,
  operation: (arguments_: InternalTriggerArguments) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const deployment = yield* DeploymentRuntimeConfig;
    const runtimeRole = yield* validateRuntimeRoleConfiguration(deployment);
    if (runtimeRole.role !== 'worker' || runtimeRole.triggerMode !== 'http') {
      return yield* Effect.fail(new HttpServerError.RouteNotFound({ request }));
    }

    const webRequest = yield* HttpServerRequest.toWeb(request);
    const webResponse = yield* handleInternalTriggerWebRequest(
      webRequest,
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
