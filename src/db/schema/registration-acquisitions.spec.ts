import { describe, expect, it } from '@effect/vitest';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { eventRegistrationAddonFulfillmentEvents } from './event-registration-addon-fulfillment-events';
import { eventRegistrationAddonPurchaseLots } from './event-registration-addon-purchase-lots';
import { eventRegistrationAddonPurchases } from './event-registration-addon-purchases';
import { eventRegistrations } from './event-registrations';
import {
  registrationAcquisitionComponentKind,
  registrationAcquisitionComponents,
  registrationAcquisitionKind,
  registrationAcquisitionPayments,
  registrationAcquisitionRefundAllocations,
  registrationAcquisitionRefundOperationKind,
  registrationAcquisitions,
  registrationTransferRefundPlanAcquisitionLinks,
} from './registration-acquisitions';
import {
  registrationTransferRefundPlanItems,
  registrationTransfers,
} from './registration-transfers';
import { tenants } from './tenants';
import { transactions } from './transactions';
import { users } from './users';

type Table = Parameters<typeof getTableConfig>[0];

const normalizeSql = (value: string) =>
  value
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/\(\s+/g, '(')
    .replaceAll(/\s+\)/g, ')')
    .trim();

const expectCheckSql = ({
  name,
  sql,
  table,
}: {
  name: string;
  sql: string;
  table: Table;
}) => {
  const constraint = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name,
  );

  expect(constraint).toBeDefined();
  if (!constraint) {
    throw new Error(`Expected ${name} check constraint`);
  }
  expect(normalizeSql(new PgDialect().sqlToQuery(constraint.value).sql)).toBe(
    normalizeSql(sql),
  );
};

const expectForeignKey = ({
  columns,
  foreignColumns,
  foreignTable,
  name,
  onDelete = 'no action',
  table,
}: {
  columns: readonly string[];
  foreignColumns: readonly string[];
  foreignTable: Table;
  name: string;
  onDelete?: 'cascade' | 'no action';
  table: Table;
}) => {
  const foreignKey = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name,
  );

  expect(foreignKey).toBeDefined();
  if (!foreignKey) {
    throw new Error(`Expected ${name} foreign key`);
  }

  const reference = foreignKey.reference();
  expect(reference.columns.map((column) => column.name)).toEqual(columns);
  expect(reference.foreignColumns.map((column) => column.name)).toEqual(
    foreignColumns,
  );
  expect(reference.foreignTable).toBe(foreignTable);
  expect(foreignKey.onDelete).toBe(onDelete);
};

const expectUniqueConstraint = ({
  columns,
  name,
  table,
}: {
  columns: readonly string[];
  name: string;
  table: Table;
}) => {
  const constraint = getTableConfig(table).uniqueConstraints.find(
    (candidate) => candidate.getName() === name,
  );

  expect(constraint).toBeDefined();
  expect(constraint?.columns.map((column) => column.name)).toEqual(columns);
};

const expectUniqueIndex = ({
  columns,
  name,
  predicate,
  table,
}: {
  columns: readonly string[];
  name: string;
  predicate: string;
  table: Table;
}) => {
  const index = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name,
  );

  expect(index?.config.unique).toBe(true);
  expect(index?.config.columns.map((column) => column.name)).toEqual(columns);
  expect(index?.config.where).toBeDefined();
  if (!index?.config.where) {
    throw new Error(`Expected ${name} index predicate`);
  }
  expect(new PgDialect().sqlToQuery(index.config.where).sql).toBe(predicate);
};

describe('registration acquisition schema', () => {
  it('requires complete non-null finalized add-on payment allocations', () => {
    const constraint = getTableConfig(
      eventRegistrationAddonPurchaseLots,
    ).checks.find(
      (candidate) =>
        candidate.name ===
        'event_registration_addon_purchase_lots_payment_allocation_shape',
    );

    expect(constraint).toBeDefined();
    if (!constraint) {
      throw new Error('Expected add-on payment allocation shape constraint');
    }

    const constraintSql = normalizeSql(
      new PgDialect().sqlToQuery(constraint.value).sql,
    );
    for (const column of [
      'tax_amount',
      'gross_amount',
      'net_amount',
      'stripe_fee_amount',
      'application_fee_amount',
    ]) {
      expect(constraintSql).toContain(
        `"event_registration_addon_purchase_lots"."${column}" IS NOT NULL`,
      );
    }
  });

  it('models one ordered and replay-safe ownership epoch chain', () => {
    expect(registrationAcquisitionKind.enumValues).toEqual([
      'initial',
      'claim_transfer',
      'direct_transfer',
    ]);

    expectCheckSql({
      name: 'registration_acquisition_epoch_shape',
      sql: `
        ("registration_acquisitions"."ordinal" = 0
          AND "registration_acquisitions"."previous_acquisition_id" IS NULL
          AND "registration_acquisitions"."kind" = 'initial'
          AND "registration_acquisitions"."transfer_id" IS NULL)
        OR ("registration_acquisitions"."ordinal" > 0
          AND "registration_acquisitions"."previous_acquisition_id" IS NOT NULL
          AND "registration_acquisitions"."kind" = 'claim_transfer'
          AND "registration_acquisitions"."transfer_id" IS NOT NULL)
        OR ("registration_acquisitions"."ordinal" > 0
          AND "registration_acquisitions"."previous_acquisition_id" IS NOT NULL
          AND "registration_acquisitions"."kind" = 'direct_transfer'
          AND "registration_acquisitions"."transfer_id" IS NULL)
      `,
      table: registrationAcquisitions,
    });
    expectCheckSql({
      name: 'registration_acquisition_spot_count_positive',
      sql: '"registration_acquisitions"."spot_count" > 0',
      table: registrationAcquisitions,
    });

    expectUniqueConstraint({
      columns: ['id', 'event_id', 'registration_id', 'tenant_id'],
      name: 'registration_acquisition_identity_unique',
      table: registrationAcquisitions,
    });
    expectUniqueConstraint({
      columns: ['tenant_id', 'registration_id', 'operation_key'],
      name: 'registration_acquisition_operation_unique',
      table: registrationAcquisitions,
    });
    expectUniqueConstraint({
      columns: ['tenant_id', 'registration_id', 'ordinal'],
      name: 'registration_acquisition_ordinal_unique',
      table: registrationAcquisitions,
    });
    expectUniqueIndex({
      columns: ['previous_acquisition_id'],
      name: 'registration_acquisition_predecessor_unique',
      predicate:
        '"registration_acquisitions"."previous_acquisition_id" IS NOT NULL',
      table: registrationAcquisitions,
    });
    expectUniqueIndex({
      columns: ['transfer_id'],
      name: 'registration_acquisition_transfer_unique',
      predicate: '"registration_acquisitions"."transfer_id" IS NOT NULL',
      table: registrationAcquisitions,
    });

    expectForeignKey({
      columns: ['registration_id', 'event_id'],
      foreignColumns: ['id', 'eventId'],
      foreignTable: eventRegistrations,
      name: 'registration_acquisition_registration_event_fk',
      table: registrationAcquisitions,
    });
    expectForeignKey({
      columns: [
        'previous_acquisition_id',
        'event_id',
        'registration_id',
        'tenant_id',
      ],
      foreignColumns: ['id', 'event_id', 'registration_id', 'tenant_id'],
      foreignTable: registrationAcquisitions,
      name: 'registration_acquisition_predecessor_fk',
      table: registrationAcquisitions,
    });
    expectForeignKey({
      columns: ['registration_id', 'tenant_id'],
      foreignColumns: ['id', 'tenantId'],
      foreignTable: eventRegistrations,
      name: 'registration_acquisition_registration_tenant_fk',
      table: registrationAcquisitions,
    });
    expectForeignKey({
      columns: ['transfer_id', 'tenant_id'],
      foreignColumns: ['id', 'tenantId'],
      foreignTable: registrationTransfers,
      name: 'registration_acquisition_transfer_tenant_fk',
      table: registrationAcquisitions,
    });
    expectForeignKey({
      columns: ['owner_user_id'],
      foreignColumns: ['id'],
      foreignTable: users,
      name: 'registration_acquisitions_owner_user_id_users_id_fk',
      table: registrationAcquisitions,
    });
    expectForeignKey({
      columns: ['tenant_id'],
      foreignColumns: ['id'],
      foreignTable: tenants,
      name: 'registration_acquisitions_tenant_id_tenants_id_fk',
      table: registrationAcquisitions,
    });
  });

  it('binds each successful source transaction to exactly one epoch', () => {
    expectUniqueConstraint({
      columns: ['acquisition_id', 'transaction_id'],
      name: 'registration_acquisition_payment_epoch_transaction_unique',
      table: registrationAcquisitionPayments,
    });
    expectUniqueConstraint({
      columns: ['id', 'acquisition_id', 'tenant_id'],
      name: 'registration_acquisition_payment_identity_unique',
      table: registrationAcquisitionPayments,
    });
    expectUniqueConstraint({
      columns: ['id', 'transaction_id', 'acquisition_id', 'tenant_id'],
      name: 'registration_acquisition_payment_source_identity_unique',
      table: registrationAcquisitionPayments,
    });
    expectUniqueConstraint({
      columns: ['transaction_id'],
      name: 'registration_acquisition_payment_transaction_unique',
      table: registrationAcquisitionPayments,
    });

    expectForeignKey({
      columns: ['acquisition_id', 'event_id', 'registration_id', 'tenant_id'],
      foreignColumns: ['id', 'event_id', 'registration_id', 'tenant_id'],
      foreignTable: registrationAcquisitions,
      name: 'registration_acquisition_payment_acquisition_fk',
      table: registrationAcquisitionPayments,
    });
    expectForeignKey({
      columns: ['transaction_id', 'registration_id', 'tenant_id'],
      foreignColumns: ['id', 'eventRegistrationId', 'tenantId'],
      foreignTable: transactions,
      name: 'registration_acquisition_payment_transaction_fk',
      table: registrationAcquisitionPayments,
    });
  });

  it('stores immutable, fully settled registration and add-on components', () => {
    expect(registrationAcquisitionComponentKind.enumValues).toEqual([
      'registration',
      'addon_lot',
    ]);

    const tableConfig = getTableConfig(registrationAcquisitionComponents);
    const columns = new Map(
      tableConfig.columns.map((column) => [column.name, column]),
    );
    expect(tableConfig.columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining([
        'updated_at',
        'refund_allocated_amount',
        'refund_allocated_quantity',
      ]),
    );
    for (const columnName of [
      'application_fee_amount',
      'base_amount',
      'gross_amount',
      'net_amount',
      'stripe_fee_amount',
      'tax_amount',
    ]) {
      expect(columns.get(columnName)?.notNull).toBe(true);
    }

    expectCheckSql({
      name: 'registration_acquisition_component_allocation_key_shape',
      sql: 'length(trim("registration_acquisition_components"."allocation_key")) BETWEEN 1 AND 100',
      table: registrationAcquisitionComponents,
    });
    expectCheckSql({
      name: 'registration_acquisition_component_amount_shape',
      sql: `
        "registration_acquisition_components"."quantity" > 0
        AND "registration_acquisition_components"."base_amount" >= 0
        AND "registration_acquisition_components"."tax_amount" >= 0
        AND "registration_acquisition_components"."tax_amount" <= "registration_acquisition_components"."gross_amount"
        AND "registration_acquisition_components"."gross_amount" >= "registration_acquisition_components"."base_amount"
        AND "registration_acquisition_components"."net_amount" >= 0
        AND "registration_acquisition_components"."stripe_fee_amount" >= 0
        AND "registration_acquisition_components"."application_fee_amount" >= 0
        AND "registration_acquisition_components"."net_amount" + "registration_acquisition_components"."stripe_fee_amount" + "registration_acquisition_components"."application_fee_amount" = "registration_acquisition_components"."gross_amount"
      `,
      table: registrationAcquisitionComponents,
    });
    expectCheckSql({
      name: 'registration_acquisition_component_kind_shape',
      sql: `
        ("registration_acquisition_components"."kind" = 'registration'
          AND "registration_acquisition_components"."purchase_id" IS NULL
          AND "registration_acquisition_components"."purchase_lot_id" IS NULL)
        OR ("registration_acquisition_components"."kind" = 'addon_lot'
          AND "registration_acquisition_components"."purchase_id" IS NOT NULL
          AND "registration_acquisition_components"."purchase_lot_id" IS NOT NULL)
      `,
      table: registrationAcquisitionComponents,
    });
    expectCheckSql({
      name: 'registration_acquisition_component_payment_shape',
      sql: `
        ("registration_acquisition_components"."gross_amount" = 0
          AND "registration_acquisition_components"."acquisition_payment_id" IS NULL
          AND "registration_acquisition_components"."base_amount" = 0
          AND "registration_acquisition_components"."tax_amount" = 0
          AND "registration_acquisition_components"."net_amount" = 0
          AND "registration_acquisition_components"."stripe_fee_amount" = 0
          AND "registration_acquisition_components"."application_fee_amount" = 0)
        OR ("registration_acquisition_components"."gross_amount" > 0
          AND "registration_acquisition_components"."acquisition_payment_id" IS NOT NULL)
      `,
      table: registrationAcquisitionComponents,
    });

    expectUniqueConstraint({
      columns: ['acquisition_id', 'allocation_key'],
      name: 'registration_acquisition_component_allocation_unique',
      table: registrationAcquisitionComponents,
    });
    expectUniqueConstraint({
      columns: ['id', 'acquisition_payment_id', 'acquisition_id', 'tenant_id'],
      name: 'registration_acquisition_component_identity_unique',
      table: registrationAcquisitionComponents,
    });
    expectUniqueIndex({
      columns: ['acquisition_id', 'purchase_lot_id'],
      name: 'registration_acquisition_component_lot_unique',
      predicate:
        '"registration_acquisition_components"."purchase_lot_id" IS NOT NULL',
      table: registrationAcquisitionComponents,
    });
    expectUniqueIndex({
      columns: ['acquisition_id'],
      name: 'registration_acquisition_component_registration_unique',
      predicate:
        '"registration_acquisition_components"."kind" = \'registration\'',
      table: registrationAcquisitionComponents,
    });

    expectForeignKey({
      columns: ['acquisition_id', 'event_id', 'registration_id', 'tenant_id'],
      foreignColumns: ['id', 'event_id', 'registration_id', 'tenant_id'],
      foreignTable: registrationAcquisitions,
      name: 'registration_acquisition_component_acquisition_fk',
      table: registrationAcquisitionComponents,
    });
    expectForeignKey({
      columns: ['purchase_lot_id', 'purchase_id', 'tenant_id'],
      foreignColumns: ['id', 'purchaseId', 'tenantId'],
      foreignTable: eventRegistrationAddonPurchaseLots,
      name: 'registration_acquisition_component_lot_fk',
      table: registrationAcquisitionComponents,
    });
    expectForeignKey({
      columns: ['acquisition_payment_id', 'acquisition_id', 'tenant_id'],
      foreignColumns: ['id', 'acquisition_id', 'tenant_id'],
      foreignTable: registrationAcquisitionPayments,
      name: 'registration_acquisition_component_payment_fk',
      table: registrationAcquisitionComponents,
    });
    expectForeignKey({
      columns: ['purchase_id', 'event_id', 'registration_id', 'tenant_id'],
      foreignColumns: ['id', 'eventId', 'registrationId', 'tenantId'],
      foreignTable: eventRegistrationAddonPurchases,
      name: 'registration_acquisition_component_purchase_fk',
      table: registrationAcquisitionComponents,
    });
  });

  it('records cancellation entitlement consumption append-only', () => {
    expect(registrationAcquisitionRefundOperationKind.enumValues).toEqual([
      'registration_cancellation',
      'addon_cancellation',
    ]);

    const tableConfig = getTableConfig(
      registrationAcquisitionRefundAllocations,
    );
    expect(tableConfig.columns.map((column) => column.name)).not.toContain(
      'updated_at',
    );

    expectCheckSql({
      name: 'registration_acquisition_refund_amount_shape',
      sql: `
        "registration_acquisition_refund_allocations"."quantity" > 0
        AND "registration_acquisition_refund_allocations"."refund_amount" > 0
        AND "registration_acquisition_refund_allocations"."gross_entitlement_amount" > 0
        AND "registration_acquisition_refund_allocations"."net_entitlement_amount" >= 0
        AND "registration_acquisition_refund_allocations"."stripe_fee_amount" >= 0
        AND "registration_acquisition_refund_allocations"."application_fee_amount" >= 0
        AND "registration_acquisition_refund_allocations"."net_entitlement_amount" + "registration_acquisition_refund_allocations"."stripe_fee_amount" + "registration_acquisition_refund_allocations"."application_fee_amount" = "registration_acquisition_refund_allocations"."gross_entitlement_amount"
      `,
      table: registrationAcquisitionRefundAllocations,
    });
    expectCheckSql({
      name: 'registration_acquisition_refund_operation_key_shape',
      sql: 'length(trim("registration_acquisition_refund_allocations"."operation_key")) BETWEEN 1 AND 100',
      table: registrationAcquisitionRefundAllocations,
    });
    expectCheckSql({
      name: 'registration_acquisition_refund_operation_shape',
      sql: `
        ("registration_acquisition_refund_allocations"."operation_kind" = 'registration_cancellation'
          AND "registration_acquisition_refund_allocations"."fulfillment_event_id" IS NULL
          AND "registration_acquisition_refund_allocations"."purchase_id" IS NULL)
        OR ("registration_acquisition_refund_allocations"."operation_kind" = 'addon_cancellation'
          AND "registration_acquisition_refund_allocations"."fulfillment_event_id" IS NOT NULL
          AND "registration_acquisition_refund_allocations"."purchase_id" IS NOT NULL)
      `,
      table: registrationAcquisitionRefundAllocations,
    });
    expectCheckSql({
      name: 'registration_acquisition_refund_policy_amount',
      sql: `
        ("registration_acquisition_refund_allocations"."application_fee_refunded"
          AND "registration_acquisition_refund_allocations"."refund_amount" = "registration_acquisition_refund_allocations"."gross_entitlement_amount")
        OR (NOT "registration_acquisition_refund_allocations"."application_fee_refunded"
          AND "registration_acquisition_refund_allocations"."refund_amount" = "registration_acquisition_refund_allocations"."net_entitlement_amount")
      `,
      table: registrationAcquisitionRefundAllocations,
    });

    expectUniqueConstraint({
      columns: ['component_id', 'operation_key'],
      name: 'registration_acquisition_refund_component_operation_unique',
      table: registrationAcquisitionRefundAllocations,
    });
    expectUniqueConstraint({
      columns: ['refund_transaction_id', 'component_id'],
      name: 'registration_acquisition_refund_transaction_component_unique',
      table: registrationAcquisitionRefundAllocations,
    });

    expectForeignKey({
      columns: ['acquisition_id', 'event_id', 'registration_id', 'tenant_id'],
      foreignColumns: ['id', 'event_id', 'registration_id', 'tenant_id'],
      foreignTable: registrationAcquisitions,
      name: 'registration_acquisition_refund_acquisition_fk',
      table: registrationAcquisitionRefundAllocations,
    });
    expectForeignKey({
      columns: [
        'component_id',
        'acquisition_payment_id',
        'acquisition_id',
        'tenant_id',
      ],
      foreignColumns: [
        'id',
        'acquisition_payment_id',
        'acquisition_id',
        'tenant_id',
      ],
      foreignTable: registrationAcquisitionComponents,
      name: 'registration_acquisition_refund_component_fk',
      table: registrationAcquisitionRefundAllocations,
    });
    expectForeignKey({
      columns: [
        'fulfillment_event_id',
        'purchase_id',
        'event_id',
        'registration_id',
        'tenant_id',
      ],
      foreignColumns: [
        'id',
        'purchaseId',
        'eventId',
        'registrationId',
        'tenantId',
      ],
      foreignTable: eventRegistrationAddonFulfillmentEvents,
      name: 'registration_acquisition_refund_event_fk',
      table: registrationAcquisitionRefundAllocations,
    });
    expectForeignKey({
      columns: ['refund_transaction_id', 'registration_id', 'tenant_id'],
      foreignColumns: ['id', 'eventRegistrationId', 'tenantId'],
      foreignTable: transactions,
      name: 'registration_acquisition_refund_transaction_fk',
      table: registrationAcquisitionRefundAllocations,
    });
  });

  it('binds each transfer refund plan item to its exact source payment', () => {
    expect(
      registrationTransferRefundPlanAcquisitionLinks.planItemId.primary,
    ).toBe(true);

    expectForeignKey({
      columns: [
        'source_acquisition_payment_id',
        'source_transaction_id',
        'source_acquisition_id',
        'tenant_id',
      ],
      foreignColumns: ['id', 'transaction_id', 'acquisition_id', 'tenant_id'],
      foreignTable: registrationAcquisitionPayments,
      name: 'registration_transfer_refund_plan_acquisition_payment_fk',
      table: registrationTransferRefundPlanAcquisitionLinks,
    });
    expectForeignKey({
      columns: ['plan_item_id', 'source_transaction_id', 'tenant_id'],
      foreignColumns: ['id', 'source_transaction_id', 'tenant_id'],
      foreignTable: registrationTransferRefundPlanItems,
      name: 'registration_transfer_refund_plan_acquisition_plan_fk',
      table: registrationTransferRefundPlanAcquisitionLinks,
    });
  });
});
