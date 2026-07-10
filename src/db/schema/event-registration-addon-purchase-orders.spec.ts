import { describe, expect, it } from '@effect/vitest';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import {
  eventRegistrationAddonPurchaseOrderOperationUniqueIndexName,
  eventRegistrationAddonPurchaseOrders,
  pendingEventRegistrationAddonPurchaseOrderUniqueIndexName,
} from './event-registration-addon-purchase-orders';

describe('event registration add-on purchase order schema', () => {
  it('allows only one pending paid add-on order per registration', () => {
    const tableConfig = getTableConfig(eventRegistrationAddonPurchaseOrders);
    const pendingIndex = tableConfig.indexes.find(
      (index) =>
        index.config.name ===
        pendingEventRegistrationAddonPurchaseOrderUniqueIndexName,
    );

    expect(pendingIndex?.config.unique).toBe(true);
    expect(pendingIndex?.config.columns.map((column) => column.name)).toEqual([
      'tenant_id',
      'registration_id',
    ]);
    const predicate = pendingIndex?.config.where;
    expect(predicate).toBeDefined();
    if (!predicate) {
      throw new Error('Expected pending add-on order predicate');
    }
    expect(new PgDialect().sqlToQuery(predicate).sql).toBe(
      `"event_registration_addon_purchase_orders"."status" = 'pending_payment'`,
    );
  });

  it('makes participant operation replay durable and tenant scoped', () => {
    const tableConfig = getTableConfig(eventRegistrationAddonPurchaseOrders);
    const operationIndex = tableConfig.indexes.find(
      (index) =>
        index.config.name ===
        eventRegistrationAddonPurchaseOrderOperationUniqueIndexName,
    );

    expect(operationIndex?.config.unique).toBe(true);
    expect(operationIndex?.config.columns.map((column) => column.name)).toEqual(
      ['tenant_id', 'registration_id', 'operation_key'],
    );
  });

  it('persists immutable commercial, Checkout, and future entitlement ownership', () => {
    const tableConfig = getTableConfig(eventRegistrationAddonPurchaseOrders);

    expect(tableConfig.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'addon_id',
        'application_fee_amount',
        'base_amount',
        'currency',
        'event_id',
        'expected_gross_amount',
        'expires_at',
        'operation_key',
        'purchase_id',
        'purchase_lot_id',
        'quantity',
        'registration_id',
        'registration_option_id',
        'requested_by_user_id',
        'stripe_tax_rate_id',
        'tax_rate_inclusive',
        'tax_rate_percentage',
        'transaction_id',
        'unit_price',
        'window',
      ]),
    );
    expect(tableConfig.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'event_registration_addon_purchase_orders_amount_shape',
        'event_registration_addon_purchase_orders_lifecycle_shape',
        'event_registration_addon_purchase_orders_operation_key_nonblank',
        'event_registration_addon_purchase_orders_tax_snapshot_shape',
      ]),
    );
    expect(
      tableConfig.foreignKeys.map((foreignKey) => foreignKey.getName()),
    ).toEqual(
      expect.arrayContaining([
        'event_registration_addon_purchase_orders_option_association_fk',
        'event_registration_addon_purchase_orders_registration_owner_fk',
        'event_registration_addon_purchase_orders_transaction_owner_fk',
      ]),
    );
  });
});
