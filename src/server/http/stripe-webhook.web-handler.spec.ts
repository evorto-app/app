import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  handleStripeWebhookWebRequest,
  MAX_STRIPE_WEBHOOK_SIZE_BYTES,
  type PersistedCheckoutSessionBinding,
  readStripeWebhookBody,
  runCheckoutWebhookTransition,
  validateCheckoutSessionBinding,
} from './stripe-webhook.web-handler';

const persistedBinding = {
  eventRegistrationId: 'registration-1',
  id: 'transaction-1',
  method: 'stripe',
  status: 'pending',
  stripeCheckoutSessionId: 'checkout-1',
  stripePaymentIntentId: null,
  tenantId: 'tenant-1',
  type: 'registration',
} satisfies PersistedCheckoutSessionBinding;

const validBindingInput = {
  eventAccount: 'acct_tenant',
  metadata: {
    registrationId: 'registration-1',
    tenantId: 'tenant-1',
    transactionId: 'transaction-1',
  },
  paymentIntentId: 'pi_1',
  persisted: persistedBinding,
  requirePaymentIntent: true,
  sessionId: 'checkout-1',
  stripeAccountId: 'acct_tenant',
};

const handlerSource = readFileSync(
  fileURLToPath(new URL('stripe-webhook.web-handler.ts', import.meta.url)),
  'utf8',
);

describe('readStripeWebhookBody', () => {
  it.effect('rejects oversized Content-Length before reading the stream', () =>
    Effect.gen(function* () {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        cancel: () => {
          cancelled = true;
        },
        pull: (controller) => {
          controller.enqueue(new Uint8Array([1]));
        },
      });

      const error = yield* Effect.flip(
        readStripeWebhookBody(
          {
            body,
            headers: new Headers({ 'content-length': '11' }),
          },
          10,
        ),
      );

      expect(error._tag).toBe('StripeWebhookBodyTooLargeError');
      expect(cancelled).toBe(true);
    }),
  );

  it.effect('cancels a streamed body as soon as it crosses the limit', () =>
    Effect.gen(function* () {
      let cancelled = false;
      let nextChunk = 0;
      const body = new ReadableStream<Uint8Array>({
        cancel: () => {
          cancelled = true;
        },
        pull: (controller) => {
          nextChunk += 1;
          controller.enqueue(new Uint8Array(nextChunk === 1 ? 6 : 5));
        },
      });

      const error = yield* Effect.flip(
        readStripeWebhookBody({ body, headers: new Headers() }, 10),
      );

      expect(error._tag).toBe('StripeWebhookBodyTooLargeError');
      expect(cancelled).toBe(true);
    }),
  );

  it.effect('preserves a chunked body exactly at the byte limit', () =>
    Effect.gen(function* () {
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
        },
      });

      const bytes = yield* readStripeWebhookBody(
        { body, headers: new Headers() },
        4,
      );

      expect([...bytes]).toEqual([1, 2, 3, 4]);
    }),
  );

  it.effect('returns an empty body when the request has no stream', () =>
    Effect.gen(function* () {
      const bytes = yield* readStripeWebhookBody(
        { body: null, headers: new Headers() },
        4,
      );

      expect(bytes.byteLength).toBe(0);
    }),
  );

  it.effect('returns 413 before requiring Stripe services or a signature', () =>
    Effect.gen(function* () {
      const response = yield* handleStripeWebhookWebRequest(
        new Request('https://tenant.example.com/webhooks/stripe', {
          body: 'oversized',
          headers: {
            'content-length': String(MAX_STRIPE_WEBHOOK_SIZE_BYTES + 1),
          },
          method: 'POST',
        }),
      );

      expect(response.status).toBe(413);
      expect(yield* Effect.promise(() => response.text())).toBe(
        'Payload too large',
      );
    }),
  );
});

describe('validateCheckoutSessionBinding', () => {
  it('accepts exact persisted, metadata, account, and payment intent bindings', () => {
    expect(validateCheckoutSessionBinding(validBindingInput)).toEqual({
      paymentIntentId: 'pi_1',
      registrationId: 'registration-1',
      stripeAccountId: 'acct_tenant',
      tenantId: 'tenant-1',
      transactionId: 'transaction-1',
      type: 'resolved',
    });
  });

  it('uses the persisted checkout session when metadata is absent', () => {
    expect(
      validateCheckoutSessionBinding({
        ...validBindingInput,
        metadata: null,
      }),
    ).toMatchObject({ type: 'resolved' });
  });

  it('rejects partial or conflicting metadata', () => {
    expect(
      validateCheckoutSessionBinding({
        ...validBindingInput,
        metadata: { tenantId: 'tenant-1' },
      }),
    ).toMatchObject({ type: 'invalid-binding' });
    expect(
      validateCheckoutSessionBinding({
        ...validBindingInput,
        metadata: {
          ...validBindingInput.metadata,
          registrationId: 'registration-foreign',
        },
      }),
    ).toMatchObject({ type: 'invalid-binding' });
  });

  it('rejects a missing or mismatched connected account', () => {
    expect(
      validateCheckoutSessionBinding({
        ...validBindingInput,
        eventAccount: undefined,
      }),
    ).toMatchObject({ type: 'invalid-binding' });
    expect(
      validateCheckoutSessionBinding({
        ...validBindingInput,
        eventAccount: 'acct_foreign',
      }),
    ).toMatchObject({ type: 'invalid-binding' });
  });

  it('rejects conflicting payment intent and transaction kinds', () => {
    expect(
      validateCheckoutSessionBinding({
        ...validBindingInput,
        persisted: {
          ...persistedBinding,
          stripePaymentIntentId: 'pi_other',
        },
      }),
    ).toMatchObject({ type: 'invalid-binding' });
    expect(
      validateCheckoutSessionBinding({
        ...validBindingInput,
        persisted: { ...persistedBinding, method: 'cash' },
      }),
    ).toMatchObject({ type: 'invalid-binding' });
  });

  it('classifies a non-pending persisted transaction as a state race', () => {
    expect(
      validateCheckoutSessionBinding({
        ...validBindingInput,
        persisted: { ...persistedBinding, status: 'successful' },
      }),
    ).toEqual({ type: 'state-conflict' });
  });
});

describe('runCheckoutWebhookTransition', () => {
  it.each([
    [
      'completion',
      "case 'checkout.session.completed':",
      "case 'checkout.session.expired':",
    ],
    ['expiry', "case 'checkout.session.expired':", 'default: {'],
  ])(
    'locks the exact %s registration row before running the guarded transition',
    (_name, startMarker, endMarker) => {
      const transitionSource = handlerSource.slice(
        handlerSource.indexOf(startMarker),
        handlerSource.indexOf(endMarker),
      );
      const registrationLock = transitionSource.indexOf(".for('update')");
      const transactionUpdate = transitionSource.indexOf(
        '.update(schema.transactions)',
      );
      const registrationUpdate = transitionSource.indexOf(
        '.update(schema.eventRegistrations)',
      );
      const optionUpdate = transitionSource.indexOf(
        '.update(schema.eventRegistrationOptions)',
      );

      expect(registrationLock).toBeGreaterThanOrEqual(0);
      expect(transactionUpdate).toBeGreaterThanOrEqual(0);
      expect(registrationUpdate).toBeGreaterThanOrEqual(0);
      expect(optionUpdate).toBeGreaterThanOrEqual(0);
    },
  );

  it('orders checkout-expiry add-on releases before updating stock rows', () => {
    const expirySource = handlerSource.slice(
      handlerSource.indexOf("case 'checkout.session.expired':"),
      handlerSource.indexOf('default: {'),
    );
    const addOnOrder = expirySource.indexOf('.orderBy(');
    const addOnUpdate = expirySource.indexOf('.update(schema.eventAddons)');

    expect(addOnOrder).toBeGreaterThanOrEqual(0);
    expect(expirySource).toMatch(
      /\.orderBy\(\s*schema\.eventRegistrationAddonPurchases\.addonId,\s*\)/u,
    );
    expect(addOnUpdate).toBeGreaterThan(addOnOrder);
  });

  it.effect(
    'locks registration before transaction update and registration mutation',
    () =>
      Effect.gen(function* () {
        const order: string[] = [];

        yield* runCheckoutWebhookTransition({
          lockRegistration: () =>
            Effect.sync(() => {
              order.push('registration-lock');
              return { id: 'registration-1' };
            }),
          updateDependents: () =>
            Effect.sync(() => {
              order.push('capacity-update');
            }),
          updateRegistration: () =>
            Effect.sync(() => {
              order.push('registration-update');
              return 1;
            }),
          updateTransaction: () =>
            Effect.sync(() => {
              order.push('transaction-update');
              return 1;
            }),
        });

        expect(order).toEqual([
          'registration-lock',
          'transaction-update',
          'registration-update',
          'capacity-update',
        ]);
      }),
  );

  it.effect(
    'stops before registration mutation when the pending transaction update loses its race',
    () =>
      Effect.gen(function* () {
        const order: string[] = [];

        const error = yield* Effect.flip(
          runCheckoutWebhookTransition({
            lockRegistration: () =>
              Effect.sync(() => {
                order.push('registration-lock');
                return { id: 'registration-1' };
              }),
            updateDependents: () =>
              Effect.sync(() => {
                order.push('capacity-update');
              }),
            updateRegistration: () =>
              Effect.sync(() => {
                order.push('registration-update');
                return 1;
              }),
            updateTransaction: () =>
              Effect.sync(() => {
                order.push('transaction-update');
                return 0;
              }),
          }),
        );

        expect(error._tag).toBe('StripeWebhookStateConflictError');
        expect(order).toEqual(['registration-lock', 'transaction-update']);
      }),
  );
});
