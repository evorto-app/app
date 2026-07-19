import { describe, expect, it } from '@effect/vitest';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import {
  paidEventTransactionMethodCheckName,
  pendingRegistrationTransactionUniqueIndexName,
  refundOperationShapeCheckName,
  type RegistrationCheckoutSnapshot,
  registrationRefundOperationUniqueIndexName,
  transactions,
} from './transactions';

describe('transaction schema', () => {
  it('enforces Stripe-only event payments and explicit automatic refund operation keys', () => {
    const tableConfig = getTableConfig(transactions);
    const paidEventMethod = tableConfig.checks.find(
      (check) => check.name === paidEventTransactionMethodCheckName,
    );
    const refundOperationShape = tableConfig.checks.find(
      (check) => check.name === refundOperationShapeCheckName,
    );

    expect(paidEventMethod).toBeDefined();
    expect(refundOperationShape).toBeDefined();
    if (!paidEventMethod || !refundOperationShape) {
      throw new Error('Expected transaction integrity checks');
    }

    expect(new PgDialect().sqlToQuery(paidEventMethod.value).sql).toBe(
      `"transactions"."type"::text NOT IN ('registration', 'addon') OR ("transactions"."method"::text = 'stripe' AND "transactions"."amount" > 0)`,
    );
    expect(
      new PgDialect().sqlToQuery(refundOperationShape.value).sql,
    ).toContain(
      '"transactions"."refund_operation_key" IS NOT NULL AND length(trim("transactions"."refund_operation_key")) BETWEEN 1 AND 100',
    );
  });

  it('enforces one pending registration payment per registration', () => {
    const tableConfig = getTableConfig(transactions);
    const pendingRegistrationIndex = tableConfig.indexes.find(
      (index) =>
        index.config.name === pendingRegistrationTransactionUniqueIndexName,
    );

    expect(pendingRegistrationIndex).toBeDefined();
    expect(pendingRegistrationIndex?.config.unique).toBe(true);
    expect(
      pendingRegistrationIndex?.config.columns.map((column) => column.name),
    ).toEqual(['eventRegistrationId']);

    const predicate = pendingRegistrationIndex?.config.where;
    expect(predicate).toBeDefined();
    if (!predicate) {
      throw new Error('Expected pending registration index predicate');
    }
    expect(new PgDialect().sqlToQuery(predicate).sql).toBe(
      `"transactions"."status" = 'pending' AND "transactions"."type" = 'registration' AND "transactions"."eventRegistrationId" IS NOT NULL`,
    );
  });

  it('stores a nullable typed checkout request snapshot', () => {
    const tableConfig = getTableConfig(transactions);
    const checkoutRequestColumn = tableConfig.columns.find(
      (column) => column.name === 'stripe_checkout_request',
    );

    expect(checkoutRequestColumn?.getSQLType()).toBe('jsonb');
    expect(checkoutRequestColumn?.notNull).toBe(false);

    const snapshot = {
      customerEmail: 'account@example.com',
      eventTitle: 'Welcome event',
      eventUrl: 'https://events.example/events/event-1',
      expiresAt: 1_800_000_000,
      lineItems: [
        {
          name: 'Registration fee for Welcome event',
          quantity: 1,
          taxRateId: 'txr_123',
          unitAmount: 1500,
        },
        {
          name: 'Guest registration fee for Welcome event',
          quantity: 2,
          unitAmount: 1500,
        },
      ],
      notificationEmail: 'preferred@example.com',
    } as const satisfies RegistrationCheckoutSnapshot;
    const transactionInsert = {
      amount: 4500,
      currency: 'EUR',
      method: 'stripe',
      status: 'pending',
      stripeCheckoutRequest: snapshot,
      tenantId: 'tenant-1',
      type: 'registration',
    } satisfies typeof transactions.$inferInsert;

    expect(transactionInsert.stripeCheckoutRequest).toEqual(snapshot);
  });

  it('stores a durable bounded Checkout reconciliation schedule', () => {
    const tableConfig = getTableConfig(transactions);
    const columns = new Map(
      tableConfig.columns.map((column) => [column.name, column]),
    );
    const retryIndex = tableConfig.indexes.find(
      (index) => index.config.name === 'transactions_checkout_reconcile_idx',
    );

    expect(columns.get('stripe_checkout_reconcile_attempts')?.notNull).toBe(
      true,
    );
    expect(columns.get('stripe_checkout_reconcile_attempts')?.default).toBe(0);
    expect(columns.has('stripe_checkout_reconcile_last_error')).toBe(true);
    expect(columns.has('stripe_checkout_reconcile_lease_expires_at')).toBe(
      true,
    );
    expect(columns.has('stripe_checkout_reconcile_lease_id')).toBe(true);
    expect(columns.has('stripe_checkout_reconcile_next_at')).toBe(true);
    expect(retryIndex?.config.columns.map((column) => column.name)).toEqual([
      'type',
      'status',
      'stripe_checkout_reconcile_next_at',
    ]);
  });

  it('stores durable Stripe refund ownership and one source-operation relation', () => {
    const tableConfig = getTableConfig(transactions);
    const refundOperationIndex = tableConfig.indexes.find(
      (index) =>
        index.config.name === registrationRefundOperationUniqueIndexName,
    );

    expect(refundOperationIndex?.config.unique).toBe(true);
    expect(
      refundOperationIndex?.config.columns.map((column) => column.name),
    ).toEqual(['tenantId', 'source_transaction_id', 'refund_operation_key']);
    const predicate = refundOperationIndex?.config.where;
    expect(predicate).toBeDefined();
    if (!predicate) {
      throw new Error('Expected refund operation index predicate');
    }
    expect(new PgDialect().sqlToQuery(predicate).sql).toBe(
      `"transactions"."type" = 'refund' AND "transactions"."source_transaction_id" IS NOT NULL AND "transactions"."refund_operation_key" IS NOT NULL`,
    );

    expect(
      tableConfig.columns.find((column) => column.name === 'stripe_account_id'),
    ).toBeDefined();
    expect(
      tableConfig.columns.find((column) => column.name === 'stripe_net_amount'),
    ).toBeDefined();
    expect(
      tableConfig.columns.find(
        (column) => column.name === 'stripe_refund_application_fee',
      ),
    ).toBeDefined();
    expect(
      tableConfig.columns.find((column) => column.name === 'stripe_refund_id'),
    ).toBeDefined();
    expect(
      tableConfig.columns.find(
        (column) => column.name === 'stripe_refund_generation',
      ),
    ).toBeDefined();
    expect(
      tableConfig.columns
        .find((column) => column.name === 'stripe_refund_history')
        ?.getSQLType(),
    ).toBe('jsonb');
    expect(
      tableConfig.columns.find(
        (column) => column.name === 'stripe_refund_status',
      ),
    ).toBeDefined();
  });
});
