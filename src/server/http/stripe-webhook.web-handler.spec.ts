import type Stripe from 'stripe';

import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Database, type DatabaseClient } from '../../db';
import * as dbSchema from '../../db/schema';
import { StripeClient } from '../stripe-client';
import {
  asyncCheckoutFailureAction,
  handleStripeWebhookWebRequest,
  isSupportedStripeWebhookEventType,
  MAX_STRIPE_WEBHOOK_BODY_SIZE_BYTES,
  MAX_STRIPE_WEBHOOK_SIZE_BYTES,
  type PersistedCheckoutSessionBinding,
  prepareStripeWebhookRequest,
  readStripeWebhookBody,
  runCheckoutWebhookTransition,
  stripeEventOwnsPersistedAccount,
  validateCheckoutSessionBinding,
} from './stripe-webhook.web-handler';

const persistedBinding = {
  eventRegistrationId: 'registration-1',
  id: 'transaction-1',
  method: 'stripe',
  status: 'pending',
  stripeAccountId: 'acct_tenant',
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

const stripeWebhookConfigLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: { STRIPE_WEBHOOK_SECRET: 'whsec_test' },
  }),
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
      transactionType: 'registration',
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

  it('dispatches add-on Checkout only from an exact persisted add-on transaction', () => {
    expect(
      validateCheckoutSessionBinding({
        ...validBindingInput,
        persisted: { ...persistedBinding, type: 'addon' },
      }),
    ).toMatchObject({
      transactionId: 'transaction-1',
      transactionType: 'addon',
      type: 'resolved',
    });
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
        persisted: { ...persistedBinding, stripeAccountId: null },
      }),
    ).toMatchObject({ type: 'invalid-binding' });
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

  it('accepts an exact cancelled registration as an idempotent expiry replay only', () => {
    const cancelledBinding = {
      ...validBindingInput,
      allowFinalizedExpiry: true,
      persisted: { ...persistedBinding, status: 'cancelled' as const },
      registrationStatus: 'CANCELLED' as const,
      requirePaymentIntent: false,
    };

    expect(validateCheckoutSessionBinding(cancelledBinding)).toEqual({
      type: 'already-finalized-expiry',
    });
    expect(
      validateCheckoutSessionBinding({
        ...cancelledBinding,
        registrationStatus: 'PENDING',
      }),
    ).toEqual({ type: 'state-conflict' });
    expect(
      validateCheckoutSessionBinding({
        ...cancelledBinding,
        eventAccount: 'acct_foreign',
      }),
    ).toMatchObject({ type: 'invalid-binding' });
    expect(
      validateCheckoutSessionBinding({
        ...cancelledBinding,
        allowFinalizedExpiry: false,
      }),
    ).toEqual({ type: 'state-conflict' });
  });
});

describe('checkout expiry replay', () => {
  const runFinalizedExpiry = (eventAccount: string) =>
    Effect.gen(function* () {
      const deletedTables: unknown[] = [];
      const updatedTables: unknown[] = [];
      const updateValues: unknown[] = [];
      const database = {
        delete: (table: unknown) => ({
          where: () => {
            deletedTables.push(table);
            return Effect.succeed([]);
          },
        }),
        insert: () => ({
          values: () => ({
            onConflictDoNothing: () => ({
              returning: () =>
                Effect.succeed([
                  { status: 'processing', stripeEventId: 'evt_expired_1' },
                ]),
            }),
          }),
        }),
        query: {
          eventRegistrations: {
            findFirst: () => Effect.succeed({ status: 'CANCELLED' }),
          },
          tenants: {
            findFirst: () => Effect.succeed({ stripeAccountId: 'acct_tenant' }),
          },
          transactions: {
            findFirst: () =>
              Effect.succeed({
                ...persistedBinding,
                status: 'cancelled',
              }),
          },
        },
        update: (table: unknown) => ({
          set: (values: unknown) => ({
            where: () => {
              updatedTables.push(table);
              updateValues.push(values);
              return Effect.succeed([]);
            },
          }),
        }),
      };
      const event = {
        account: eventAccount,
        data: {
          object: {
            id: 'checkout-1',
            metadata: validBindingInput.metadata,
            payment_intent: null,
            status: 'expired',
          },
        },
        id: 'evt_expired_1',
        type: 'checkout.session.expired',
      } as Stripe.Event;
      const stripe = {
        webhooks: {
          constructEvent: () => event,
        },
      } as Stripe;

      const response = yield* handleStripeWebhookWebRequest(
        new Request('https://tenant.example.com/webhooks/stripe', {
          body: '{}',
          headers: { 'stripe-signature': 'test-signature' },
          method: 'POST',
        }),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Database, database as DatabaseClient),
            Layer.succeed(StripeClient, stripe),
            stripeWebhookConfigLayer,
          ),
        ),
      );

      return { deletedTables, response, updatedTables, updateValues };
    });

  it.effect(
    'acknowledges an exact already-cancelled expiry and marks its claim processed without releasing resources again',
    () =>
      Effect.gen(function* () {
        const result = yield* runFinalizedExpiry('acct_tenant');

        expect(result.response.status).toBe(200);
        expect(yield* Effect.promise(() => result.response.text())).toBe(
          'Success',
        );
        expect(result.updatedTables).toEqual([dbSchema.stripeWebhookEvents]);
        expect(result.updateValues).toEqual([
          expect.objectContaining({ status: 'processed' }),
        ]);
        expect(result.deletedTables).toEqual([]);
      }),
  );

  it.effect('rejects the replay when the connected account mismatches', () =>
    Effect.gen(function* () {
      const result = yield* runFinalizedExpiry('acct_foreign');

      expect(result.response.status).toBe(400);
      expect(result.updatedTables).toEqual([]);
      expect(result.deletedTables).toEqual([dbSchema.stripeWebhookEvents]);
    }),
  );
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

const createStreamRequest = (
  chunks: readonly Uint8Array[],
  headers: HeadersInit = {},
) => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  const init = {
    body,
    duplex: 'half',
    headers: {
      'stripe-signature': 'test-signature',
      ...Object.fromEntries(new Headers(headers)),
    },
    method: 'POST',
  } satisfies RequestInit & { duplex: 'half' };

  return new Request('https://tenant.example.com/webhooks/stripe', init);
};

describe('prepareStripeWebhookRequest', () => {
  it('routes delayed payment success and failure through durable webhook claims', () => {
    expect(
      isSupportedStripeWebhookEventType(
        'checkout.session.async_payment_succeeded',
      ),
    ).toBe(true);
    expect(
      isSupportedStripeWebhookEventType(
        'checkout.session.async_payment_failed',
      ),
    ).toBe(true);
    expect(asyncCheckoutFailureAction({ status: 'open' })).toBe('keepOpen');
    expect(
      asyncCheckoutFailureAction({
        payment_status: 'paid',
        status: 'complete',
      }),
    ).toBe('complete');
    expect(
      asyncCheckoutFailureAction({
        payment_status: 'unpaid',
        status: 'complete',
      }),
    ).toBe('cancel');
    expect(asyncCheckoutFailureAction({ status: 'expired' })).toBe('cancel');
  });

  it('requires an exact persisted Connect account match', () => {
    expect(stripeEventOwnsPersistedAccount('acct_1', 'acct_1')).toBe(true);
    expect(stripeEventOwnsPersistedAccount('acct_other', 'acct_1')).toBe(false);
    expect(stripeEventOwnsPersistedAccount(undefined, 'acct_1')).toBe(false);
    expect(stripeEventOwnsPersistedAccount('acct_1', null)).toBe(false);
  });

  it.effect('does not read an unsigned webhook body', () =>
    Effect.gen(function* () {
      const body = new ReadableStream<Uint8Array>({
        pull() {
          throw new Error('body should not be read');
        },
      });
      const init = {
        body,
        duplex: 'half',
        method: 'POST',
      } satisfies RequestInit & { duplex: 'half' };
      const request = new Request(
        'https://tenant.example.com/webhooks/stripe',
        init,
      );

      const response = yield* prepareStripeWebhookRequest(request);

      expect(response).toBeInstanceOf(Response);
      if (response instanceof Response) {
        expect(response.status).toBe(400);
        expect(yield* Effect.promise(() => response.text())).toBe(
          'No signature',
        );
      }
    }),
  );

  it.effect('rejects a webhook declared above the route limit', () =>
    Effect.gen(function* () {
      const request = createStreamRequest([new Uint8Array([1])], {
        'content-length': String(MAX_STRIPE_WEBHOOK_BODY_SIZE_BYTES + 1),
      });

      const response = yield* prepareStripeWebhookRequest(request);

      expect(response).toBeInstanceOf(Response);
      if (response instanceof Response) {
        expect(response.status).toBe(413);
        expect(yield* Effect.promise(() => response.text())).toBe(
          'Payload too large',
        );
      }
    }),
  );

  it.effect(
    'rejects an oversized streamed webhook without Content-Length',
    () =>
      Effect.gen(function* () {
        const request = createStreamRequest([
          new Uint8Array(MAX_STRIPE_WEBHOOK_BODY_SIZE_BYTES + 1),
        ]);
        expect(request.headers.get('content-length')).toBeNull();

        const response = yield* prepareStripeWebhookRequest(request);

        expect(response).toBeInstanceOf(Response);
        if (response instanceof Response) {
          expect(response.status).toBe(413);
        }
      }),
  );

  it.effect('does not trust a smaller webhook Content-Length', () =>
    Effect.gen(function* () {
      const request = createStreamRequest(
        [new Uint8Array(MAX_STRIPE_WEBHOOK_BODY_SIZE_BYTES + 1)],
        { 'content-length': '1' },
      );

      const response = yield* prepareStripeWebhookRequest(request);

      expect(response).toBeInstanceOf(Response);
      if (response instanceof Response) {
        expect(response.status).toBe(413);
      }
    }),
  );

  it.effect('accepts a signed webhook within the route limit', () =>
    Effect.gen(function* () {
      const request = createStreamRequest([new TextEncoder().encode('{}')]);

      const prepared = yield* prepareStripeWebhookRequest(request);

      expect(prepared).not.toBeInstanceOf(Response);
      if (!(prepared instanceof Response)) {
        expect(prepared.signature).toBe('test-signature');
        expect(new TextDecoder().decode(prepared.rawBody)).toBe('{}');
      }
    }),
  );

  it.effect('rejects an invalid webhook Content-Length', () =>
    Effect.gen(function* () {
      const request = createStreamRequest([new TextEncoder().encode('{}')], {
        'content-length': 'invalid',
      });

      const response = yield* prepareStripeWebhookRequest(request);

      expect(response).toBeInstanceOf(Response);
      if (response instanceof Response) {
        expect(response.status).toBe(400);
        expect(yield* Effect.promise(() => response.text())).toBe(
          'Invalid Content-Length',
        );
      }
    }),
  );
});
