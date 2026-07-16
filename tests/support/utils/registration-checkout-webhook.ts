import type { APIRequestContext } from '@playwright/test';

import Stripe from 'stripe';

import { getId } from '../../../helpers/get-id';
import { resolveStripeWebhookSecret } from '../../../helpers/testing/stripe-webhook-secret';
import { createSettledStripeTestPayment } from './settled-stripe-test-payment';

export const deliverCompletedRegistrationCheckoutWebhook = async ({
  amount,
  applicationFeeAmount,
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
  applicationFeeAmount: null | number;
  currency: string;
  paymentIntentId: null | string;
  registrationId: string;
  request: APIRequestContext;
  sessionId: string;
  stripeAccountId: string;
  tenantId: string;
  transactionId: string;
}): Promise<void> => {
  const webhookSecret = await resolveStripeWebhookSecret();
  if (paymentIntentId !== null) {
    throw new Error(
      'Expected the deterministic completion helper to own an unbound payment intent',
    );
  }
  const settledPayment = await createSettledStripeTestPayment({
    amount,
    applicationFeeAmount,
    currency,
    stripeAccountId,
    transactionId,
  });

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
          id: settledPayment.paymentIntentId,
          latest_charge: settledPayment.chargeId,
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

export const deliverRegistrationRefundWebhook = async ({
  amount,
  chargeId,
  currency,
  refundClaimId,
  refundGeneration,
  refundId,
  registrationId,
  request,
  sourceTransactionId,
  status,
  stripeAccountId,
  stripeEventId,
  tenantId,
}: {
  amount: number;
  chargeId: string;
  currency: string;
  refundClaimId: string;
  refundGeneration: number;
  refundId: string;
  registrationId: string;
  request: APIRequestContext;
  sourceTransactionId: string;
  status: 'failed' | 'requires_action' | 'succeeded';
  stripeAccountId: string;
  stripeEventId: string;
  tenantId: string;
}): Promise<void> => {
  const webhookSecret = await resolveStripeWebhookSecret();
  const payload = JSON.stringify({
    account: stripeAccountId,
    api_version: '2024-11-20.acacia',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        amount,
        charge: chargeId,
        currency: currency.toLowerCase(),
        id: refundId,
        metadata: {
          refundClaimId,
          refundGeneration: String(refundGeneration),
          registrationId,
          sourceTransactionId,
          tenantId,
        },
        object: 'refund',
        payment_intent: null,
        status,
      },
    },
    id: stripeEventId,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: status === 'failed' ? 'refund.failed' : 'refund.updated',
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
      `Expected registration refund webhook to return 200, received ${response.status()} with body "${responseBody}"`,
    );
  }
};
