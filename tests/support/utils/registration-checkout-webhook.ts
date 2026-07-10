import type { APIRequestContext } from '@playwright/test';

import Stripe from 'stripe';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getId } from '../../../helpers/get-id';

const execFileAsync = promisify(execFile);
let resolvedWebhookSecret: Promise<string> | undefined;

const readDockerWebhookSecret = async (): Promise<string | undefined> => {
  const composeProject = process.env['COMPOSE_PROJECT_NAME']?.trim();
  if (!composeProject) return;

  try {
    const { stdout: containerOutput } = await execFileAsync('docker', [
      'ps',
      '--quiet',
      '--filter',
      `label=com.docker.compose.project=${composeProject}`,
      '--filter',
      'label=com.docker.compose.service=evorto',
    ]);
    const containerId = containerOutput.trim().split(/\s+/u)[0];
    if (!containerId || !/^[a-f0-9]+$/u.test(containerId)) return;

    const { stdout: secretOutput } = await execFileAsync('docker', [
      'exec',
      containerId,
      'cat',
      '/run/stripe-webhook/signing-secret',
    ]);
    return secretOutput.trim() || undefined;
  } catch {
    return;
  }
};

const resolveWebhookSecret = (): Promise<string> => {
  resolvedWebhookSecret ??= (async () => {
    const dockerSecret = await readDockerWebhookSecret();
    const staticSecret = process.env['STRIPE_WEBHOOK_SECRET']?.trim();
    const secret = dockerSecret || staticSecret;
    if (!secret) {
      throw new Error(
        'A Docker runtime or STRIPE_WEBHOOK_SECRET is required for registration payment tests',
      );
    }
    return secret;
  })();
  return resolvedWebhookSecret;
};

export const deliverCompletedRegistrationCheckoutWebhook = async ({
  amount,
  currency,
  paymentIntentId,
  registrationId,
  request,
  sessionId,
  stripeAccountId,
  tenantId,
  transactionId,
}: {
  amount: number;
  currency: string;
  paymentIntentId: null | string;
  registrationId: string;
  request: APIRequestContext;
  sessionId: string;
  stripeAccountId: string;
  tenantId: string;
  transactionId: string;
}): Promise<void> => {
  const webhookSecret = await resolveWebhookSecret();

  const payload = JSON.stringify({
    account: stripeAccountId,
    api_version: '2024-11-20.acacia',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        amount_total: amount,
        currency: currency.toLowerCase(),
        id: sessionId,
        metadata: {
          registrationId,
          tenantId,
          transactionId,
        },
        object: 'checkout.session',
        payment_intent: {
          id: paymentIntentId ?? `pi_test_${getId()}`,
          latest_charge: `ch_test_${getId()}`,
        },
        payment_status: 'paid',
        status: 'complete',
      },
    },
    id: `evt_test_${getId()}`,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: 'checkout.session.completed',
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  const response = await request.fetch('/webhooks/stripe', {
    data: Buffer.from(payload, 'utf8'),
    failOnStatusCode: false,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    method: 'POST',
  });
  const responseBody = await response.text();

  if (response.status() !== 200) {
    throw new Error(
      `Expected completed registration Checkout webhook to return 200, received ${response.status()} with body "${responseBody}"`,
    );
  }
};
