import { HttpRouter as HttpLayerRouter } from 'effect/unstable/http';

import {
  attachTenantPaymentAccount,
  TenantPaymentSetupArguments,
} from '../payments/tenant-payment-setup';
import { handleWorkerJsonTrigger } from './worker-email-delivery.route';

export const WORKER_PAYMENT_SETUP_PATH =
  '/internal/worker/payment-setup' as const;

export const workerPaymentSetupRouteLayer = HttpLayerRouter.add(
  'POST',
  WORKER_PAYMENT_SETUP_PATH,
  (request) =>
    handleWorkerJsonTrigger(
      request,
      TenantPaymentSetupArguments,
      attachTenantPaymentAccount,
    ),
);
