import { describe, expect, it } from '@effect/vitest';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import {
  activeRegistrationTransferSourceUniqueIndexName,
  registrationTransferAnswers,
  registrationTransferBundleAddonPurchaseLots,
  registrationTransferBundleAddonPurchases,
  registrationTransferEvents,
  registrationTransferExpiryIndexName,
  registrationTransferRefundPlanItems,
  registrationTransfers,
} from './registration-transfers';

const expectCheckSql = ({
  name,
  sql,
  table,
}: {
  name: string;
  sql: string;
  table: Parameters<typeof getTableConfig>[0];
}) => {
  const constraint = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name,
  );

  expect(constraint).toBeDefined();
  if (!constraint) {
    throw new Error(`Expected ${name} check constraint`);
  }
  expect(new PgDialect().sqlToQuery(constraint.value).sql).toBe(sql);
};

const expectForeignKey = ({
  columns,
  foreignColumns,
  name,
  onDelete,
  table,
}: {
  columns: readonly string[];
  foreignColumns: readonly string[];
  name: string;
  onDelete?: 'cascade' | 'no action';
  table: Parameters<typeof getTableConfig>[0];
}) => {
  const foreignKey = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name,
  );

  expect(foreignKey).toBeDefined();
  if (!foreignKey) {
    throw new Error(`Expected ${name} foreign key`);
  }
  expect(foreignKey.reference().columns.map((column) => column.name)).toEqual(
    columns,
  );
  expect(
    foreignKey.reference().foreignColumns.map((column) => column.name),
  ).toEqual(foreignColumns);
  if (onDelete) {
    expect(foreignKey.onDelete).toBe(onDelete);
  }
};

const expectUniqueConstraint = ({
  columns,
  name,
  table,
}: {
  columns: readonly string[];
  name: string;
  table: Parameters<typeof getTableConfig>[0];
}) => {
  const constraint = getTableConfig(table).uniqueConstraints.find(
    (candidate) => candidate.getName() === name,
  );

  expect(constraint).toBeDefined();
  expect(constraint?.columns.map((column) => column.name)).toEqual(columns);
};

describe('registration transfer schema', () => {
  it('allows only one active offer for a source registration', () => {
    const tableConfig = getTableConfig(registrationTransfers);
    const activeSourceIndex = tableConfig.indexes.find(
      (index) =>
        index.config.name === activeRegistrationTransferSourceUniqueIndexName,
    );

    expect(activeSourceIndex?.config.unique).toBe(true);
    expect(
      activeSourceIndex?.config.columns.map((column) => column.name),
    ).toEqual(['source_registration_id']);
    const predicate = activeSourceIndex?.config.where;
    expect(predicate).toBeDefined();
    if (!predicate) {
      throw new Error('Expected active transfer source predicate');
    }
    expect(new PgDialect().sqlToQuery(predicate).sql).toBe(
      `"registration_transfers"."status" IN ('open', 'checkout_pending', 'refund_pending', 'refund_failed')`,
    );
  });

  it('stores only claim hashes and indexes expirable offers', () => {
    const tableConfig = getTableConfig(registrationTransfers);
    const columnNames = tableConfig.columns.map((column) => column.name);
    const expiryIndex = tableConfig.indexes.find(
      (index) => index.config.name === registrationTransferExpiryIndexName,
    );

    expect(columnNames).toContain('claim_token_hash');
    expect(columnNames).toContain('claim_code_hash');
    expect(columnNames).not.toContain('claim_token');
    expect(columnNames).not.toContain('claim_code');
    expect(expiryIndex?.config.columns.map((column) => column.name)).toEqual([
      'status',
      'expires_at',
    ]);
  });

  it('keeps the transferred registration and capacity in place', () => {
    const tableConfig = getTableConfig(registrationTransfers);
    const columnNames = tableConfig.columns.map((column) => column.name);

    expect(columnNames).toEqual(
      expect.arrayContaining([
        'compensation_refund_transaction_id',
        'recipient_checkout_transaction_id',
        'recipient_registration_id',
        'recipient_spot_count',
        'reserved_additional_spots',
        'source_registration_id',
        'source_spot_count',
      ]),
    );
    expect(columnNames).not.toContain('refund_transaction_id');
    expect(columnNames).not.toContain('source_payment_transaction_id');
    expect(columnNames).not.toContain('source_refund_amount');
    expect(columnNames).not.toContain('source_refund_application_fee');
    expect(tableConfig.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'registration_transfers_recipient_is_source_registration',
        'registration_transfers_recipient_preserves_spots',
        'registration_transfers_recipient_spot_count_positive',
        'registration_transfers_reserved_spots_nonnegative',
        'registration_transfers_source_spot_count_positive',
      ]),
    );

    expectCheckSql({
      name: 'registration_transfers_recipient_is_source_registration',
      sql: `"registration_transfers"."recipient_registration_id" IS NULL OR "registration_transfers"."recipient_registration_id" = "registration_transfers"."source_registration_id"`,
      table: registrationTransfers,
    });
    expectCheckSql({
      name: 'registration_transfers_recipient_preserves_spots',
      sql: `"registration_transfers"."recipient_spot_count" IS NULL OR "registration_transfers"."recipient_spot_count" = "registration_transfers"."source_spot_count"`,
      table: registrationTransfers,
    });
    expectCheckSql({
      name: 'registration_transfers_reserved_spots_nonnegative',
      sql: `"registration_transfers"."reserved_additional_spots" = 0`,
      table: registrationTransfers,
    });

    expectUniqueConstraint({
      columns: ['id', 'tenantId'],
      name: 'registration_transfers_id_tenant_unique',
      table: registrationTransfers,
    });
    expectForeignKey({
      columns: ['compensation_refund_transaction_id', 'tenantId'],
      foreignColumns: ['id', 'tenantId'],
      name: 'registration_transfers_compensation_refund_tenant_fk',
      table: registrationTransfers,
    });
    expectForeignKey({
      columns: ['recipient_checkout_transaction_id', 'tenantId'],
      foreignColumns: ['id', 'tenantId'],
      name: 'registration_transfers_recipient_checkout_tenant_fk',
      table: registrationTransfers,
    });
    expectForeignKey({
      columns: ['recipient_registration_id', 'tenantId'],
      foreignColumns: ['id', 'tenantId'],
      name: 'registration_transfers_recipient_registration_tenant_fk',
      table: registrationTransfers,
    });
    expectForeignKey({
      columns: ['source_registration_id', 'tenantId'],
      foreignColumns: ['id', 'tenantId'],
      name: 'registration_transfers_source_registration_tenant_fk',
      table: registrationTransfers,
    });
  });

  it('snapshots the full add-on bundle with immutable fulfillment history', () => {
    const tableConfig = getTableConfig(
      registrationTransferBundleAddonPurchases,
    );
    const columnNames = tableConfig.columns.map((column) => column.name);

    expect(columnNames).toEqual(
      expect.arrayContaining([
        'addon_id',
        'cancelled_quantity',
        'included_quantity',
        'purchased_quantity',
        'quantity',
        'recipient_unit_price',
        'redeemed_quantity',
        'refund_allocated_purchased_quantity',
        'registration_option_id',
        'source_purchase_id',
        'tenant_id',
        'transfer_id',
        'unit_price',
      ]),
    );
    expect(columnNames).not.toContain('updated_at');
    expect(tableConfig.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'registration_transfer_bundle_fulfillment_bounds',
        'registration_transfer_bundle_grant_breakdown',
        'registration_transfer_bundle_price_nonnegative',
        'registration_transfer_bundle_refund_bounds',
      ]),
    );
    expectUniqueConstraint({
      columns: ['transfer_id', 'addon_id'],
      name: 'registration_transfer_bundle_addon_unique',
      table: registrationTransferBundleAddonPurchases,
    });
    expectUniqueConstraint({
      columns: ['transfer_id', 'source_purchase_id'],
      name: 'registration_transfer_bundle_purchase_unique',
      table: registrationTransferBundleAddonPurchases,
    });
    expectForeignKey({
      columns: ['source_purchase_id', 'tenant_id'],
      foreignColumns: ['id', 'tenantId'],
      name: 'registration_transfer_bundle_purchase_tenant_fk',
      table: registrationTransferBundleAddonPurchases,
    });
    expectForeignKey({
      columns: ['transfer_id', 'tenant_id'],
      foreignColumns: ['id', 'tenantId'],
      name: 'registration_transfer_bundle_transfer_tenant_fk',
      onDelete: 'cascade',
      table: registrationTransferBundleAddonPurchases,
    });
  });

  it('seals exact inherited purchase-lot membership', () => {
    const tableConfig = getTableConfig(
      registrationTransferBundleAddonPurchaseLots,
    );
    expect(tableConfig.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'source_purchase_id',
        'source_purchase_lot_id',
        'source_transaction_id',
        'quantity',
        'redeemed_quantity',
        'cancelled_quantity',
        'refund_allocated_quantity',
      ]),
    );
    expectUniqueConstraint({
      columns: ['transfer_id', 'source_purchase_lot_id'],
      name: 'registration_transfer_bundle_addon_lot_unique',
      table: registrationTransferBundleAddonPurchaseLots,
    });
    expectForeignKey({
      columns: ['source_purchase_lot_id', 'source_purchase_id', 'tenant_id'],
      foreignColumns: ['id', 'purchaseId', 'tenantId'],
      name: 'registration_transfer_bundle_addon_lot_owner_fk',
      table: registrationTransferBundleAddonPurchaseLots,
    });
  });

  it('plans one exact Stripe refund per original source payment', () => {
    const tableConfig = getTableConfig(registrationTransferRefundPlanItems);
    const refundIndex = tableConfig.indexes.find(
      (index) =>
        index.config.name === 'registration_transfer_refund_plan_refund_unique',
    );

    expect(tableConfig.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'application_fee_refunded',
        'currency',
        'operation_key',
        'original_amount',
        'prior_refunded_amount',
        'refund_amount_due',
        'refund_transaction_id',
        'source_registration_id',
        'source_transaction_id',
        'source_transaction_type',
        'stripe_account_id',
        'tenant_id',
        'transfer_id',
      ]),
    );
    expect(tableConfig.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'registration_transfer_refund_plan_amount_shape',
        'registration_transfer_refund_plan_application_fee_shape',
        'registration_transfer_refund_plan_operation_key_nonblank',
        'registration_transfer_refund_plan_source_type_shape',
      ]),
    );
    expectUniqueConstraint({
      columns: ['transfer_id', 'source_transaction_id'],
      name: 'registration_transfer_refund_plan_source_unique',
      table: registrationTransferRefundPlanItems,
    });
    expect(refundIndex?.config.unique).toBe(true);
    expect(refundIndex?.config.columns.map((column) => column.name)).toEqual([
      'refund_transaction_id',
    ]);
    const refundPredicate = refundIndex?.config.where;
    expect(refundPredicate).toBeDefined();
    if (!refundPredicate) {
      throw new Error('Expected refund-plan refund predicate');
    }
    expect(new PgDialect().sqlToQuery(refundPredicate).sql).toBe(
      `"registration_transfer_refund_plan_items"."refund_transaction_id" IS NOT NULL`,
    );

    expectForeignKey({
      columns: ['refund_transaction_id', 'tenant_id'],
      foreignColumns: ['id', 'tenantId'],
      name: 'registration_transfer_refund_plan_refund_tenant_fk',
      table: registrationTransferRefundPlanItems,
    });
    expectForeignKey({
      columns: ['source_registration_id', 'tenant_id'],
      foreignColumns: ['id', 'tenantId'],
      name: 'registration_transfer_refund_plan_registration_tenant_fk',
      table: registrationTransferRefundPlanItems,
    });
    expectForeignKey({
      columns: ['source_transaction_id', 'tenant_id'],
      foreignColumns: ['id', 'tenantId'],
      name: 'registration_transfer_refund_plan_source_tenant_fk',
      table: registrationTransferRefundPlanItems,
    });
    expectForeignKey({
      columns: ['transfer_id', 'tenant_id'],
      foreignColumns: ['id', 'tenantId'],
      name: 'registration_transfer_refund_plan_transfer_tenant_fk',
      onDelete: 'no action',
      table: registrationTransferRefundPlanItems,
    });
  });

  it('snapshots transfer answers under the transfer tenant', () => {
    const tableConfig = getTableConfig(registrationTransferAnswers);

    expect(tableConfig.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'answer',
        'question_id',
        'tenant_id',
        'transfer_id',
      ]),
    );
    expectUniqueConstraint({
      columns: ['transfer_id', 'question_id'],
      name: 'registration_transfer_answers_question_unique',
      table: registrationTransferAnswers,
    });
    expectForeignKey({
      columns: ['transfer_id', 'tenant_id'],
      foreignColumns: ['id', 'tenantId'],
      name: 'registration_transfer_answers_transfer_tenant_fk',
      onDelete: 'cascade',
      table: registrationTransferAnswers,
    });
  });

  it('keeps transfer history append-only and ordered per transfer', () => {
    const tableConfig = getTableConfig(registrationTransferEvents);

    expect(tableConfig.columns.map((column) => column.name)).not.toContain(
      'updated_at',
    );
    expect(
      tableConfig.indexes.map((index) => ({
        columns: index.config.columns.map((column) => column.name),
        name: index.config.name,
      })),
    ).toEqual([
      {
        columns: ['transfer_id', 'created_at'],
        name: 'registration_transfer_events_transfer_idx',
      },
    ]);
    expectForeignKey({
      columns: ['transfer_id', 'tenant_id'],
      foreignColumns: ['id', 'tenantId'],
      name: 'registration_transfer_events_transfer_tenant_fk',
      onDelete: 'cascade',
      table: registrationTransferEvents,
    });
  });
});
