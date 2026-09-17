import type * as SqlConnection from 'effect/unstable/sql/SqlConnection';

import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';

import * as dbSchema from '../../db/schema';
import { StripeClient } from '../stripe-client';
import { createDatabaseTestLayer } from '../testing/database-test-layer';
import { createRegistrationDatabaseTestLayer } from '../testing/registration-database';
import {
  createRejectingStripeClient,
  stripeCheckoutSessionResponse,
} from '../testing/stripe-test-fixtures';
import {
  asyncCheckoutFailureAction,
  checkoutSessionBindingsMatch,
  decodeStripeRefundWebhookObject,
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
const registrationCheckoutCompletionSource = readFileSync(
  fileURLToPath(
    new URL(
      '../registrations/registration-checkout-completion.ts',
      import.meta.url,
    ),
  ),
  'utf8',
);

const stripeWebhookSecret = 'whsec_test';
const stripeWebhookConfigLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: { STRIPE_WEBHOOK_SECRET: stripeWebhookSecret },
  }),
);

const createWebhookReceiptFixture = (input: {
  eventId: string;
  eventType: string;
  tenantId?: string;
}) => {
  const deletedTables: (typeof dbSchema.stripeWebhookEvents)[] = [];
  const updatedTables: (typeof dbSchema.stripeWebhookEvents)[] = [];
  const updateValues: Pick<
    typeof dbSchema.stripeWebhookEvents.$inferSelect,
    'processedAt' | 'status'
  >[] = [];
  const writes: string[] = [];
  const executeReceipt: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) =>
    Effect.sync(() => {
      if (statement.startsWith('insert into "stripe_webhook_events" ')) {
        expect(statement).toBe(
          'insert into "stripe_webhook_events" ("event_type", "processed_at", "status", "stripe_event_id", "tenant_id") values ($1, default, default, $2, ' +
            (input.tenantId ? '$3' : 'default') +
            ') on conflict do nothing returning "status", "stripe_event_id"',
        );
        expect(parameters).toEqual([
          input.eventType,
          input.eventId,
          ...(input.tenantId ? [input.tenantId] : []),
        ]);
        writes.push('claim');
        return [['processing', input.eventId]];
      }
      if (statement.startsWith('update "stripe_webhook_events" ')) {
        expect(statement).toBe(
          'update "stripe_webhook_events" set "processed_at" = $1, "status" = $2 where "stripe_webhook_events"."stripe_event_id" = $3',
        );
        const [processedAt, status, eventId] = parameters;
        if (typeof processedAt !== 'string' || status !== 'processed') {
          throw new Error('Expected a processed webhook receipt timestamp');
        }
        expect(parameters).toHaveLength(3);
        expect(eventId).toBe(input.eventId);
        const date = new Date(processedAt);
        expect(Number.isFinite(date.getTime())).toBe(true);
        updatedTables.push(dbSchema.stripeWebhookEvents);
        updateValues.push({ processedAt: date, status });
        writes.push('processed');
        return [];
      }
      if (statement.startsWith('delete from "stripe_webhook_events" ')) {
        expect(statement).toBe(
          'delete from "stripe_webhook_events" where "stripe_webhook_events"."stripe_event_id" = $1',
        );
        expect(parameters).toEqual([input.eventId]);
        deletedTables.push(dbSchema.stripeWebhookEvents);
        writes.push('released');
        return [];
      }
      throw new Error(`Unexpected webhook receipt SQL: ${statement}`);
    });
  return { deletedTables, executeReceipt, updatedTables, updateValues, writes };
};

const createProviderRefundFixture = (input: {
  eventId: string;
  metadataClaimId?: string;
  refundId: string;
  sourceStatus: 'pending' | 'successful';
}) => {
  const receipt = createWebhookReceiptFixture({
    eventId: input.eventId,
    eventType: 'refund.created',
  });
  const transactionCommands: string[] = [];
  let transactionOpen = false;
  let providerInsertCount = 0;
  let persistedRefund:
    | Pick<
        typeof dbSchema.transactions.$inferSelect,
        | 'amount'
        | 'id'
        | 'sourceTransactionId'
        | 'status'
        | 'stripeAccountId'
        | 'stripeRefundId'
        | 'stripeRefundStatus'
        | 'tenantId'
      >
    | undefined;
  const source = {
    amount: 2500,
    currency: 'EUR',
    eventId: 'event-1',
    eventRegistrationId: 'registration-1',
    id: 'transaction-1',
    status: input.sourceStatus,
    stripeAccountId: 'acct_tenant',
    stripeChargeId: 'ch_source',
    stripePaymentIntentId: 'pi_source',
    targetUserId: 'attendee-1',
    tenantId: 'tenant-1',
  } satisfies Pick<
    typeof dbSchema.transactions.$inferSelect,
    | 'amount'
    | 'currency'
    | 'eventId'
    | 'eventRegistrationId'
    | 'id'
    | 'status'
    | 'stripeAccountId'
    | 'stripeChargeId'
    | 'stripePaymentIntentId'
    | 'targetUserId'
    | 'tenantId'
  >;
  const executeRefund: SqlConnection.Connection['executeValues'] = (
    statement,
    parameters,
  ) => {
    if (
      statement.startsWith('insert into "stripe_webhook_events" ') ||
      statement.startsWith('update "stripe_webhook_events" ') ||
      statement.startsWith('delete from "stripe_webhook_events" ')
    ) {
      expect(transactionOpen).toBe(false);
      return receipt.executeReceipt(statement, parameters);
    }
    return Effect.sync(() => {
      expect(transactionOpen).toBe(true);
      if (
        statement.startsWith(
          'select "amount", "currency", "eventRegistrationId",',
        )
      ) {
        const predicate = input.metadataClaimId
          ? '((("transactions"."id" = $1) or ("transactions"."stripe_refund_id" = $2))) and ("transactions"."method" = $3) and ("transactions"."type" = $4)'
          : '("transactions"."stripe_refund_id" = $1) and ("transactions"."method" = $2) and ("transactions"."type" = $3)';
        expect(statement).toBe(
          'select "amount", "currency", "eventRegistrationId", "id", "refund_operation_key", "source_transaction_id", "stripe_account_id", "stripe_refund_attempts", "stripe_refund_generation", "stripe_refund_history", "stripe_refund_id", "stripe_refund_max_attempts", "stripe_refund_status", "tenantId" from "transactions" where (' +
            predicate +
            ') for update',
        );
        expect(parameters).toEqual([
          ...(input.metadataClaimId ? [input.metadataClaimId] : []),
          input.refundId,
          'stripe',
          'refund',
        ]);
        return [];
      }
      if (
        statement.startsWith(
          'select "amount", "currency", "eventId", "eventRegistrationId", "id", "status",',
        )
      ) {
        expect(statement).toBe(
          'select "amount", "currency", "eventId", "eventRegistrationId", "id", "status", "stripe_account_id", "stripeChargeId", "stripePaymentIntentId", "targetUserId", "tenantId" from "transactions" where (((("transactions"."stripeChargeId" = $1) or ("transactions"."stripePaymentIntentId" = $2))) and ("transactions"."method" = $3) and ("transactions"."type" in ($4, $5))) order by "transactions"."id" for update',
        );
        expect(parameters).toEqual([
          'ch_source',
          'pi_source',
          'stripe',
          'registration',
          'addon',
        ]);
        return [
          [
            source.amount,
            source.currency,
            source.eventId,
            source.eventRegistrationId,
            source.id,
            source.status,
            source.stripeAccountId,
            source.stripeChargeId,
            source.stripePaymentIntentId,
            source.targetUserId,
            source.tenantId,
          ],
        ];
      }
      if (
        statement.startsWith(
          'select "amount", "currency", "eventId", "eventRegistrationId", "id", "manuallyCreated",',
        )
      ) {
        expect(input.sourceStatus).toBe('successful');
        expect(statement).toContain(
          '"refund_operation_key", "source_transaction_id", "status", "stripe_account_id", "stripe_refund_attempts"',
        );
        expect(statement).toContain(
          'from "transactions" where (("transactions"."source_transaction_id" = $1) and ("transactions"."tenantId" = $2) and ("transactions"."type" = $3)) order by "transactions"."id" for update',
        );
        expect(parameters).toEqual(['transaction-1', 'tenant-1', 'refund']);
        return [];
      }
      if (statement.startsWith('insert into "transactions" ')) {
        providerInsertCount += 1;
        expect(input.sourceStatus).toBe('successful');
        expect(statement).toContain(
          'insert into "transactions" ("createdAt", "id", "updatedAt", "tenantId", "amount", "appFee", "comment", "currency", "eventId", "eventRegistrationId", "executiveUserId", "manuallyCreated", "method", "refund_operation_key", "source_transaction_id", "status", "stripe_account_id", "stripeChargeId", "stripe_checkout_cancellation_requested_at", "stripe_checkout_incident_session_id", "stripe_checkout_reconcile_attempts", "stripe_checkout_reconcile_last_error", "stripe_checkout_reconcile_lease_expires_at", "stripe_checkout_reconcile_lease_id", "stripe_checkout_reconcile_next_at", "stripe_checkout_request", "stripeCheckoutSessionId", "stripeCheckoutUrl", "stripeFee", "stripe_net_amount", "stripePaymentIntentId", "stripe_refund_application_fee", "stripe_refund_attempts", "stripe_refund_claim_lease_expires_at", "stripe_refund_claim_lease_id", "stripe_refund_generation", "stripe_refund_history", "stripe_refund_id", "stripe_refund_last_error", "stripe_refund_last_requeue_reason", "stripe_refund_max_attempts", "stripe_refund_next_attempt_at", "stripe_refund_requeued_at", "stripe_refund_status", "targetUserId", "type")',
        );
        expect(statement).toContain(
          'values (default, $1, default, $2, $3, default, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, default, default, default, default, default, default, default, default, default, default, default, default, default, default, $15, default, $16, $17, default, default, $18, $19, default, default, $20, default, $21, $22, $23) on conflict do nothing returning "id"',
        );
        const id = parameters[0];
        const tenantId = parameters[1];
        const amount = parameters[2];
        const sourceTransactionId = parameters[11];
        const status = parameters[12];
        const stripeAccountId = parameters[13];
        const stripeRefundId = parameters[17];
        const stripeRefundStatus = parameters[20];
        if (
          typeof id !== 'string' ||
          typeof tenantId !== 'string' ||
          typeof amount !== 'number' ||
          typeof sourceTransactionId !== 'string' ||
          status !== 'successful' ||
          typeof stripeAccountId !== 'string' ||
          typeof stripeRefundId !== 'string' ||
          stripeRefundStatus !== 'succeeded'
        ) {
          throw new Error('Expected the typed provider refund INSERT tuple');
        }
        expect(id).toHaveLength(20);
        expect(parameters).toEqual([
          id,
          'tenant-1',
          -900,
          'Refund recorded by Stripe',
          'EUR',
          'event-1',
          'registration-1',
          null,
          false,
          'stripe',
          `stripe-provider-refund:${createHash('sha256').update(input.refundId).digest('hex')}`,
          'transaction-1',
          'successful',
          'acct_tenant',
          false,
          null,
          null,
          input.refundId,
          null,
          null,
          'succeeded',
          'attendee-1',
          'refund',
        ]);
        persistedRefund = {
          amount,
          id,
          sourceTransactionId,
          status,
          stripeAccountId,
          stripeRefundId,
          stripeRefundStatus,
          tenantId,
        };
        return [[id]];
      }
      throw new Error(`Unexpected provider refund SQL: ${statement}`);
    });
  };
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: executeRefund,
    transactionControl: (command) =>
      Effect.sync(() => {
        expect(transactionOpen).toBe(command !== 'BEGIN');
        transactionOpen = command === 'BEGIN';
        transactionCommands.push(command);
      }),
  });
  return {
    ...receipt,
    databaseLayer,
    get persistedRefund() {
      return persistedRefund;
    },
    get providerInsertCount() {
      return providerInsertCount;
    },
    transactionCommands,
  };
};

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
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            createDatabaseTestLayer(),
            Layer.succeed(StripeClient, createRejectingStripeClient()),
            stripeWebhookConfigLayer,
          ),
        ),
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
    const addonBinding = validateCheckoutSessionBinding({
      ...validBindingInput,
      persisted: { ...persistedBinding, type: 'addon' },
    });

    expect(addonBinding).toMatchObject({
      transactionId: 'transaction-1',
      transactionType: 'addon',
      type: 'resolved',
    });
    if (addonBinding.type !== 'resolved') {
      throw new Error('Expected an exact add-on Checkout binding');
    }

    expect(checkoutSessionBindingsMatch(addonBinding, addonBinding)).toBe(true);
    expect(
      checkoutSessionBindingsMatch(addonBinding, {
        ...addonBinding,
        paymentIntentId: 'pi_foreign',
      }),
    ).toBe(false);
    expect(
      checkoutSessionBindingsMatch(addonBinding, {
        ...addonBinding,
        stripeAccountId: 'acct_foreign',
      }),
    ).toBe(false);
    expect(
      checkoutSessionBindingsMatch(addonBinding, {
        ...addonBinding,
        transactionType: 'registration',
      }),
    ).toBe(false);
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

  it('allows only terminal successful registration replays through the authoritative finalizer', () => {
    expect(
      validateCheckoutSessionBinding({
        ...validBindingInput,
        persisted: { ...persistedBinding, status: 'successful' },
        registrationStatus: 'CONFIRMED',
      }),
    ).toMatchObject({
      transactionType: 'registration',
      type: 'resolved',
    });
    expect(
      validateCheckoutSessionBinding({
        ...validBindingInput,
        persisted: { ...persistedBinding, status: 'successful' },
        registrationStatus: 'CANCELLED',
      }),
    ).toMatchObject({
      transactionType: 'registration',
      type: 'resolved',
    });

    for (const registrationStatus of [
      undefined,
      'PENDING',
      'WAITLIST',
    ] as const) {
      expect(
        validateCheckoutSessionBinding({
          ...validBindingInput,
          persisted: { ...persistedBinding, status: 'successful' },
          registrationStatus,
        }),
      ).toEqual({ type: 'state-conflict' });
    }

    expect(
      validateCheckoutSessionBinding({
        ...validBindingInput,
        persisted: {
          ...persistedBinding,
          status: 'successful',
          type: 'addon',
        },
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

describe('Stripe refund webhook payloads', () => {
  it.effect('decodes the refund fields used for ownership reconciliation', () =>
    Effect.gen(function* () {
      const refund = yield* decodeStripeRefundWebhookObject({
        amount: 1900,
        charge: 'ch_source',
        currency: 'eur',
        id: 're_valid',
        metadata: {
          refundClaimId: 'refund-claim-1',
          refundGeneration: '0',
          registrationId: 'registration-1',
          sourceTransactionId: 'transaction-1',
          tenantId: 'tenant-1',
        },
        object: 'refund',
        payment_intent: 'pi_source',
        status: 'pending',
      });

      expect(refund).toMatchObject({
        amount: 1900,
        id: 're_valid',
        object: 'refund',
        status: 'pending',
      });
    }),
  );

  it.effect(
    'rejects a signed refund event carrying the wrong object shape',
    () =>
      Effect.gen(function* () {
        const payload = JSON.stringify({
          account: 'acct_tenant',
          api_version: '2026-06-24.dahlia',
          created: 1_700_000_000,
          data: {
            object: {
              amount: 1900,
              charge: 'ch_source',
              currency: 'eur',
              id: 're_invalid',
              metadata: { refundClaimId: 'refund-claim-1' },
              object: 'charge',
              payment_intent: 'pi_source',
              status: 'pending',
            },
          },
          id: 'evt_invalid_refund',
          livemode: false,
          object: 'event',
          pending_webhooks: 1,
          request: null,
          type: 'refund.updated',
        });
        const signature = Stripe.webhooks.generateTestHeaderString({
          payload,
          secret: stripeWebhookSecret,
        });
        const response = yield* handleStripeWebhookWebRequest(
          new Request('https://tenant.example.com/webhooks/stripe', {
            body: payload,
            headers: { 'stripe-signature': signature },
            method: 'POST',
          }),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              createDatabaseTestLayer(),
              Layer.succeed(StripeClient, createRejectingStripeClient()),
              stripeWebhookConfigLayer,
            ),
          ),
        );

        expect(response.status).toBe(400);
        expect(yield* Effect.promise(() => response.text())).toBe(
          'Invalid refund payload',
        );
      }),
  );

  it.effect(
    'persists a signed provider refund despite unrelated claim-like metadata',
    () =>
      Effect.gen(function* () {
        const fixture = createProviderRefundFixture({
          eventId: 'evt_provider_refund',
          metadataClaimId: 'copied-unrelated-claim',
          refundId: 're_provider',
          sourceStatus: 'successful',
        });
        const payload = JSON.stringify({
          account: 'acct_tenant',
          api_version: '2026-06-24.dahlia',
          created: 1_700_000_000,
          data: {
            object: {
              amount: 900,
              charge: 'ch_source',
              currency: 'eur',
              id: 're_provider',
              metadata: { refundClaimId: 'copied-unrelated-claim' },
              object: 'refund',
              payment_intent: 'pi_source',
              status: 'succeeded',
            },
          },
          id: 'evt_provider_refund',
          livemode: false,
          object: 'event',
          pending_webhooks: 1,
          request: null,
          type: 'refund.created',
        });
        const signature = Stripe.webhooks.generateTestHeaderString({
          payload,
          secret: stripeWebhookSecret,
        });

        const response = yield* handleStripeWebhookWebRequest(
          new Request('https://tenant.example.com/webhooks/stripe', {
            body: payload,
            headers: { 'stripe-signature': signature },
            method: 'POST',
          }),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              fixture.databaseLayer,
              Layer.succeed(StripeClient, createRejectingStripeClient()),
              stripeWebhookConfigLayer,
            ),
          ),
        );

        expect(response.status).toBe(200);
        expect(yield* Effect.promise(() => response.text())).toBe('Success');
        expect(fixture.persistedRefund).toMatchObject({
          amount: -900,
          sourceTransactionId: 'transaction-1',
          status: 'successful',
          stripeAccountId: 'acct_tenant',
          stripeRefundId: 're_provider',
          stripeRefundStatus: 'succeeded',
          tenantId: 'tenant-1',
        });
        expect(fixture.providerInsertCount).toBe(1);
        expect(fixture.writes).toEqual(['claim', 'processed']);
        expect(fixture.transactionCommands).toEqual([
          'BEGIN',
          'COMMIT',
          'BEGIN',
          'COMMIT',
        ]);
      }),
  );

  it.effect(
    'releases the webhook claim while the matching source checkout is still pending',
    () =>
      Effect.gen(function* () {
        const fixture = createProviderRefundFixture({
          eventId: 'evt_provider_pending_source',
          refundId: 're_provider_pending_source',
          sourceStatus: 'pending',
        });
        const payload = JSON.stringify({
          account: 'acct_tenant',
          api_version: '2026-06-24.dahlia',
          created: 1_700_000_000,
          data: {
            object: {
              amount: 900,
              charge: 'ch_source',
              currency: 'eur',
              id: 're_provider_pending_source',
              metadata: {},
              object: 'refund',
              payment_intent: 'pi_source',
              status: 'succeeded',
            },
          },
          id: 'evt_provider_pending_source',
          livemode: false,
          object: 'event',
          pending_webhooks: 1,
          request: null,
          type: 'refund.created',
        });
        const signature = Stripe.webhooks.generateTestHeaderString({
          payload,
          secret: stripeWebhookSecret,
        });

        const response = yield* handleStripeWebhookWebRequest(
          new Request('https://tenant.example.com/webhooks/stripe', {
            body: payload,
            headers: { 'stripe-signature': signature },
            method: 'POST',
          }),
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              fixture.databaseLayer,
              Layer.succeed(StripeClient, createRejectingStripeClient()),
              stripeWebhookConfigLayer,
            ),
          ),
        );

        expect(response.status).toBe(409);
        expect(yield* Effect.promise(() => response.text())).toBe(
          'Refund source payment is not finalized',
        );
        expect(fixture.providerInsertCount).toBe(0);
        expect(fixture.deletedTables).toEqual([dbSchema.stripeWebhookEvents]);
        expect(fixture.updatedTables).toEqual([]);
        expect(fixture.writes).toEqual(['claim', 'released']);
        expect(fixture.transactionCommands).toEqual([
          'BEGIN',
          'COMMIT',
          'BEGIN',
          'COMMIT',
        ]);
      }),
  );
});

describe('checkout expiry replay', () => {
  const runFinalizedExpiry = (eventAccount: string) =>
    Effect.gen(function* () {
      const receipt = createWebhookReceiptFixture({
        eventId: 'evt_expired_1',
        eventType: 'checkout.session.expired',
        tenantId: 'tenant-1',
      });
      const binding = {
        ...persistedBinding,
        status: 'cancelled',
      } satisfies PersistedCheckoutSessionBinding;
      const registration = { status: 'CANCELLED' } satisfies Pick<
        typeof dbSchema.eventRegistrations.$inferSelect,
        'status'
      >;
      const tenant = { stripeAccountId: 'acct_tenant' } satisfies Pick<
        typeof dbSchema.tenants.$inferSelect,
        'stripeAccountId'
      >;
      const reads: string[] = [];
      const executeExpiry: SqlConnection.Connection['executeValues'] = (
        statement,
        parameters,
      ) => {
        if (
          statement.startsWith('insert into "stripe_webhook_events" ') ||
          statement.startsWith('update "stripe_webhook_events" ') ||
          statement.startsWith('delete from "stripe_webhook_events" ')
        ) {
          return receipt.executeReceipt(statement, parameters);
        }
        return Effect.sync(() => {
          if (statement.includes('from "transactions" as "d0"')) {
            expect(statement).toBe(
              'select "d0"."eventRegistrationId" as "eventRegistrationId", "d0"."id" as "id", "d0"."method" as "method", "d0"."status" as "status", "d0"."stripe_account_id" as "stripeAccountId", "d0"."stripeCheckoutSessionId" as "stripeCheckoutSessionId", "d0"."stripePaymentIntentId" as "stripePaymentIntentId", "d0"."tenantId" as "tenantId", "d0"."type" as "type" from "transactions" as "d0" where "d0"."stripeCheckoutSessionId" = $1 limit $2',
            );
            expect(parameters).toEqual(['checkout-1', 1]);
            reads.push('binding');
            return [
              [
                binding.eventRegistrationId,
                binding.id,
                binding.method,
                binding.status,
                binding.stripeAccountId,
                binding.stripeCheckoutSessionId,
                binding.stripePaymentIntentId,
                binding.tenantId,
                binding.type,
              ],
            ];
          }
          if (statement.includes('from "event_registrations" as "d0"')) {
            expect(statement).toBe(
              'select "d0"."status" as "status" from "event_registrations" as "d0" where (("d0"."id" = $1) and ("d0"."tenantId" = $2)) limit $3',
            );
            expect(parameters).toEqual(['registration-1', 'tenant-1', 1]);
            reads.push('registration');
            return [[registration.status]];
          }
          if (statement.includes('from "tenants" as "d0"')) {
            expect(statement).toBe(
              'select "d0"."stripeAccountId" as "stripeAccountId" from "tenants" as "d0" where "d0"."id" = $1 limit $2',
            );
            expect(parameters).toEqual(['tenant-1', 1]);
            reads.push('tenant');
            return [[tenant.stripeAccountId]];
          }
          throw new Error(`Unexpected finalized-expiry SQL: ${statement}`);
        });
      };
      const databaseLayer = createRegistrationDatabaseTestLayer({
        executeValues: executeExpiry,
        transactionControl: () =>
          Effect.die(
            new Error(
              'Finalized expiry must not start another resource transition',
            ),
          ),
      });
      const event = {
        account: eventAccount,
        api_version: '2026-06-24.dahlia',
        created: 1_700_000_000,
        data: {
          object: stripeCheckoutSessionResponse({
            id: 'checkout-1',
            metadata: validBindingInput.metadata,
            payment_intent: null,
            payment_status: 'unpaid',
            status: 'expired',
            url: null,
          }),
        },
        id: 'evt_expired_1',
        livemode: false,
        object: 'event',
        pending_webhooks: 1,
        request: null,
        type: 'checkout.session.expired',
      } satisfies Stripe.CheckoutSessionExpiredEvent;
      const payload = JSON.stringify(event);
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: stripeWebhookSecret,
      });
      const response = yield* handleStripeWebhookWebRequest(
        new Request('https://tenant.example.com/webhooks/stripe', {
          body: payload,
          headers: { 'stripe-signature': signature },
          method: 'POST',
        }),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            databaseLayer,
            Layer.succeed(StripeClient, createRejectingStripeClient()),
            stripeWebhookConfigLayer,
          ),
        ),
      );
      expect(reads).toEqual(['binding', 'registration', 'tenant']);
      expect(receipt.writes).toEqual([
        'claim',
        eventAccount === 'acct_tenant' ? 'processed' : 'released',
      ]);
      return {
        deletedTables: receipt.deletedTables,
        response,
        updatedTables: receipt.updatedTables,
        updateValues: receipt.updateValues,
      };
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
  it('delegates completion to the registration-first locked finalizer', () => {
    const completionCase = handlerSource.slice(
      handlerSource.indexOf("case 'checkout.session.completed':"),
      handlerSource.indexOf("case 'checkout.session.expired':"),
    );
    const completionTransaction = registrationCheckoutCompletionSource.slice(
      registrationCheckoutCompletionSource.indexOf(
        'return yield* Database.use',
      ),
    );
    const registrationLock = completionTransaction.indexOf(
      '.from(eventRegistrations)',
    );
    const registrationForUpdate = completionTransaction.indexOf(
      ".for('update')",
      registrationLock,
    );
    const transactionLock = completionTransaction.indexOf(
      '.from(transactions)',
      registrationForUpdate,
    );
    const transactionForUpdate = completionTransaction.indexOf(
      ".for('update')",
      transactionLock,
    );
    const transactionUpdate = completionTransaction.indexOf(
      '.update(transactions)',
      transactionForUpdate,
    );
    const registrationUpdate = completionTransaction.indexOf(
      '.update(eventRegistrations)',
      transactionUpdate,
    );
    const optionUpdate = completionTransaction.indexOf(
      '.update(eventRegistrationOptions)',
      registrationUpdate,
    );

    expect(completionCase).toContain('completePaidRegistrationCheckout(');
    expect(completionCase).toContain("error.kind === 'stateConflict'");
    expect(completionCase).toContain("error.kind === 'invalidBinding'");
    expect(registrationCheckoutCompletionSource).toContain(
      'paymentIntent.id !== paymentIntentId',
    );
    expect(registrationCheckoutCompletionSource).toContain(
      'Stripe payment intent is missing during checkout completion',
    );
    expect(registrationLock).toBeGreaterThanOrEqual(0);
    expect(registrationForUpdate).toBeGreaterThan(registrationLock);
    expect(transactionLock).toBeGreaterThan(registrationForUpdate);
    expect(transactionForUpdate).toBeGreaterThan(transactionLock);
    expect(transactionUpdate).toBeGreaterThan(transactionForUpdate);
    expect(registrationUpdate).toBeGreaterThan(transactionUpdate);
    expect(optionUpdate).toBeGreaterThan(registrationUpdate);
    expect(completionTransaction).toContain(
      'stripeCheckoutCancellationRequestedAt: null',
    );
  });

  it('locks the exact expiry registration row before running the guarded transition', () => {
    const transitionSource = handlerSource.slice(
      handlerSource.indexOf("case 'checkout.session.expired':"),
      handlerSource.indexOf('default: {'),
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
  });

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
