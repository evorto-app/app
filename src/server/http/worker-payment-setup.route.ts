import { Effect } from 'effect';
import {
  HttpRouter as HttpLayerRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http';

import { DeploymentRuntimeConfig } from '../config/deployment-config';
import {
  attachTenantPaymentAccount,
  TenantPaymentSetupArguments,
} from '../payments/tenant-payment-setup';
import { validateRuntimeRoleConfiguration } from '../runtime/runtime-role';
import { handleInternalJsonTriggerWebRequest } from './internal-trigger.web-handler';

export const WORKER_PAYMENT_SETUP_PATH =
  '/internal/worker/payment-setup' as const;

const handlePaymentSetup = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const deployment = yield* DeploymentRuntimeConfig;
    const runtimeRole = yield* validateRuntimeRoleConfiguration(deployment);
    if (runtimeRole.role !== 'worker' || runtimeRole.triggerMode !== 'http') {
      return yield* Effect.fail(new HttpServerError.RouteNotFound({ request }));
    }

    const webRequest = yield* HttpServerRequest.toWeb(request);
    const webResponse = yield* handleInternalJsonTriggerWebRequest(
      webRequest,
      TenantPaymentSetupArguments,
      attachTenantPaymentAccount,
    );
    return HttpServerResponse.fromWeb(webResponse);
  });

export const workerPaymentSetupRouteLayer = HttpLayerRouter.add(
  'POST',
  WORKER_PAYMENT_SETUP_PATH,
  handlePaymentSetup,
);
