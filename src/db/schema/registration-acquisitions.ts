import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventRegistrationAddonFulfillmentEvents } from './event-registration-addon-fulfillment-events';
import { eventRegistrationAddonPurchaseLots } from './event-registration-addon-purchase-lots';
import { eventRegistrationAddonPurchases } from './event-registration-addon-purchases';
import { eventRegistrations } from './event-registrations';
import {
  registrationTransferRefundPlanItems,
  registrationTransfers,
} from './registration-transfers';
import { currencyEnum, tenants } from './tenants';
import { transactions } from './transactions';
import { users } from './users';

export const registrationAcquisitionKind = pgEnum(
  'registration_acquisition_kind',
  ['initial', 'claim_transfer', 'direct_transfer'],
);

export const registrationAcquisitionComponentKind = pgEnum(
  'registration_acquisition_component_kind',
  ['registration', 'addon_lot'],
);

export const registrationAcquisitionRefundOperationKind = pgEnum(
  'registration_acquisition_refund_operation_kind',
  ['registration_cancellation', 'addon_cancellation'],
);

/** Immutable ownership epoch for one unchanged registration row. */
export const registrationAcquisitions = pgTable(
  'registration_acquisitions',
  {
    acquiredAt: timestamp('acquired_at').notNull(),
    eventId: varchar('event_id', { length: 20 }).notNull(),
    id: varchar('id', { length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    kind: registrationAcquisitionKind().notNull(),
    operationKey: varchar('operation_key', { length: 100 }).notNull(),
    ordinal: integer('ordinal').notNull(),
    ownerUserId: varchar('owner_user_id', { length: 20 })
      .notNull()
      .references(() => users.id),
    previousAcquisitionId: varchar('previous_acquisition_id', { length: 20 }),
    registrationId: varchar('registration_id', { length: 20 }).notNull(),
    spotCount: integer('spot_count').notNull(),
    tenantId: varchar('tenant_id', { length: 20 })
      .notNull()
      .references(() => tenants.id),
    transferId: varchar('transfer_id', { length: 20 }),
  },
  (table) => ({
    byCurrentOwner: index('registration_acquisition_current_idx').on(
      table.tenantId,
      table.registrationId,
      table.ordinal,
    ),
    epochShape: check(
      'registration_acquisition_epoch_shape',
      sql`(
        ${table.ordinal} = 0 AND ${table.previousAcquisitionId} IS NULL AND ${table.kind} = 'initial' AND ${table.transferId} IS NULL
      ) OR (
        ${table.ordinal} > 0 AND ${table.previousAcquisitionId} IS NOT NULL AND ${table.kind} = 'claim_transfer' AND ${table.transferId} IS NOT NULL
      ) OR (
        ${table.ordinal} > 0 AND ${table.previousAcquisitionId} IS NOT NULL AND ${table.kind} = 'direct_transfer' AND ${table.transferId} IS NULL
      )`,
    ),
    eventOwner: foreignKey({
      columns: [table.registrationId, table.eventId],
      foreignColumns: [eventRegistrations.id, eventRegistrations.eventId],
      name: 'registration_acquisition_registration_event_fk',
    }),
    identity: unique('registration_acquisition_identity_unique').on(
      table.id,
      table.eventId,
      table.registrationId,
      table.tenantId,
    ),
    operationUnique: unique('registration_acquisition_operation_unique').on(
      table.tenantId,
      table.registrationId,
      table.operationKey,
    ),
    ordinalUnique: unique('registration_acquisition_ordinal_unique').on(
      table.tenantId,
      table.registrationId,
      table.ordinal,
    ),
    predecessor: foreignKey({
      columns: [
        table.previousAcquisitionId,
        table.eventId,
        table.registrationId,
        table.tenantId,
      ],
      foreignColumns: [
        table.id,
        table.eventId,
        table.registrationId,
        table.tenantId,
      ],
      name: 'registration_acquisition_predecessor_fk',
    }),
    predecessorUnique: uniqueIndex(
      'registration_acquisition_predecessor_unique',
    )
      .on(table.previousAcquisitionId)
      .where(sql`${table.previousAcquisitionId} IS NOT NULL`),
    spotCountPositive: check(
      'registration_acquisition_spot_count_positive',
      sql`${table.spotCount} > 0`,
    ),
    tenantOwner: foreignKey({
      columns: [table.registrationId, table.tenantId],
      foreignColumns: [eventRegistrations.id, eventRegistrations.tenantId],
      name: 'registration_acquisition_registration_tenant_fk',
    }),
    transferTenant: foreignKey({
      columns: [table.transferId, table.tenantId],
      foreignColumns: [
        registrationTransfers.id,
        registrationTransfers.tenantId,
      ],
      name: 'registration_acquisition_transfer_tenant_fk',
    }),
    transferUnique: uniqueIndex('registration_acquisition_transfer_unique')
      .on(table.transferId)
      .where(sql`${table.transferId} IS NOT NULL`),
  }),
);

/** A successful payment economically owned by one acquisition epoch. */
export const registrationAcquisitionPayments = pgTable(
  'registration_acquisition_payments',
  {
    acquisitionId: varchar('acquisition_id', { length: 20 }).notNull(),
    attachedAt: timestamp('attached_at').notNull(),
    eventId: varchar('event_id', { length: 20 }).notNull(),
    id: varchar('id', { length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    registrationId: varchar('registration_id', { length: 20 }).notNull(),
    tenantId: varchar('tenant_id', { length: 20 }).notNull(),
    transactionId: varchar('transaction_id', { length: 20 }).notNull(),
  },
  (table) => ({
    acquisitionOwner: foreignKey({
      columns: [
        table.acquisitionId,
        table.eventId,
        table.registrationId,
        table.tenantId,
      ],
      foreignColumns: [
        registrationAcquisitions.id,
        registrationAcquisitions.eventId,
        registrationAcquisitions.registrationId,
        registrationAcquisitions.tenantId,
      ],
      name: 'registration_acquisition_payment_acquisition_fk',
    }),
    acquisitionTransactionUnique: unique(
      'registration_acquisition_payment_epoch_transaction_unique',
    ).on(table.acquisitionId, table.transactionId),
    identity: unique('registration_acquisition_payment_identity_unique').on(
      table.id,
      table.acquisitionId,
      table.tenantId,
    ),
    sourceIdentity: unique(
      'registration_acquisition_payment_source_identity_unique',
    ).on(table.id, table.transactionId, table.acquisitionId, table.tenantId),
    transactionOwner: foreignKey({
      columns: [table.transactionId, table.registrationId, table.tenantId],
      foreignColumns: [
        transactions.id,
        transactions.eventRegistrationId,
        transactions.tenantId,
      ],
      name: 'registration_acquisition_payment_transaction_fk',
    }),
    transactionUnique: unique(
      'registration_acquisition_payment_transaction_unique',
    ).on(table.transactionId),
  }),
);

/** Settled immutable value assigned to one registration or exact add-on lot. */
export const registrationAcquisitionComponents = pgTable(
  'registration_acquisition_components',
  {
    acquiredAt: timestamp('acquired_at').notNull(),
    acquisitionId: varchar('acquisition_id', { length: 20 }).notNull(),
    acquisitionPaymentId: varchar('acquisition_payment_id', { length: 20 }),
    allocationKey: varchar('allocation_key', { length: 100 }).notNull(),
    applicationFeeAmount: integer('application_fee_amount').notNull(),
    baseAmount: integer('base_amount').notNull(),
    currency: currencyEnum('currency').notNull(),
    eventId: varchar('event_id', { length: 20 }).notNull(),
    grossAmount: integer('gross_amount').notNull(),
    id: varchar('id', { length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    kind: registrationAcquisitionComponentKind().notNull(),
    netAmount: integer('net_amount').notNull(),
    purchaseId: varchar('purchase_id', { length: 20 }),
    purchaseLotId: varchar('purchase_lot_id', { length: 20 }),
    quantity: integer('quantity').notNull(),
    registrationId: varchar('registration_id', { length: 20 }).notNull(),
    stripeFeeAmount: integer('stripe_fee_amount').notNull(),
    taxAmount: integer('tax_amount').notNull(),
    taxRateDisplayName: text('tax_rate_name'),
    taxRateInclusive: boolean('tax_rate_inclusive'),
    taxRatePercentage: text('tax_rate_percentage'),
    tenantId: varchar('tenant_id', { length: 20 }).notNull(),
  },
  (table) => ({
    acquisitionOwner: foreignKey({
      columns: [
        table.acquisitionId,
        table.eventId,
        table.registrationId,
        table.tenantId,
      ],
      foreignColumns: [
        registrationAcquisitions.id,
        registrationAcquisitions.eventId,
        registrationAcquisitions.registrationId,
        registrationAcquisitions.tenantId,
      ],
      name: 'registration_acquisition_component_acquisition_fk',
    }),
    allocationKeyShape: check(
      'registration_acquisition_component_allocation_key_shape',
      sql`length(trim(${table.allocationKey})) BETWEEN 1 AND 100`,
    ),
    allocationUnique: unique(
      'registration_acquisition_component_allocation_unique',
    ).on(table.acquisitionId, table.allocationKey),
    amountShape: check(
      'registration_acquisition_component_amount_shape',
      sql`${table.quantity} > 0 AND ${table.baseAmount} >= 0 AND ${table.taxAmount} >= 0 AND ${table.taxAmount} <= ${table.grossAmount} AND ${table.grossAmount} >= ${table.baseAmount} AND ${table.netAmount} >= 0 AND ${table.stripeFeeAmount} >= 0 AND ${table.applicationFeeAmount} >= 0 AND ${table.netAmount} + ${table.stripeFeeAmount} + ${table.applicationFeeAmount} = ${table.grossAmount}`,
    ),
    identity: unique('registration_acquisition_component_identity_unique').on(
      table.id,
      table.acquisitionPaymentId,
      table.acquisitionId,
      table.tenantId,
    ),
    kindShape: check(
      'registration_acquisition_component_kind_shape',
      sql`(${table.kind} = 'registration' AND ${table.purchaseId} IS NULL AND ${table.purchaseLotId} IS NULL) OR (${table.kind} = 'addon_lot' AND ${table.purchaseId} IS NOT NULL AND ${table.purchaseLotId} IS NOT NULL)`,
    ),
    lotOwner: foreignKey({
      columns: [table.purchaseLotId, table.purchaseId, table.tenantId],
      foreignColumns: [
        eventRegistrationAddonPurchaseLots.id,
        eventRegistrationAddonPurchaseLots.purchaseId,
        eventRegistrationAddonPurchaseLots.tenantId,
      ],
      name: 'registration_acquisition_component_lot_fk',
    }),
    lotUnique: uniqueIndex('registration_acquisition_component_lot_unique')
      .on(table.acquisitionId, table.purchaseLotId)
      .where(sql`${table.purchaseLotId} IS NOT NULL`),
    paymentOwner: foreignKey({
      columns: [
        table.acquisitionPaymentId,
        table.acquisitionId,
        table.tenantId,
      ],
      foreignColumns: [
        registrationAcquisitionPayments.id,
        registrationAcquisitionPayments.acquisitionId,
        registrationAcquisitionPayments.tenantId,
      ],
      name: 'registration_acquisition_component_payment_fk',
    }),
    paymentShape: check(
      'registration_acquisition_component_payment_shape',
      sql`(${table.grossAmount} = 0 AND ${table.acquisitionPaymentId} IS NULL AND ${table.baseAmount} = 0 AND ${table.taxAmount} = 0 AND ${table.netAmount} = 0 AND ${table.stripeFeeAmount} = 0 AND ${table.applicationFeeAmount} = 0) OR (${table.grossAmount} > 0 AND ${table.acquisitionPaymentId} IS NOT NULL)`,
    ),
    purchaseOwner: foreignKey({
      columns: [
        table.purchaseId,
        table.eventId,
        table.registrationId,
        table.tenantId,
      ],
      foreignColumns: [
        eventRegistrationAddonPurchases.id,
        eventRegistrationAddonPurchases.eventId,
        eventRegistrationAddonPurchases.registrationId,
        eventRegistrationAddonPurchases.tenantId,
      ],
      name: 'registration_acquisition_component_purchase_fk',
    }),
    registrationComponentUnique: uniqueIndex(
      'registration_acquisition_component_registration_unique',
    )
      .on(table.acquisitionId)
      .where(sql`${table.kind} = 'registration'`),
  }),
);

/** Append-only consumption of one component's cancellation entitlement. */
export const registrationAcquisitionRefundAllocations = pgTable(
  'registration_acquisition_refund_allocations',
  {
    acquisitionId: varchar('acquisition_id', { length: 20 }).notNull(),
    acquisitionPaymentId: varchar('acquisition_payment_id', {
      length: 20,
    }).notNull(),
    applicationFeeAmount: integer('application_fee_amount').notNull(),
    applicationFeeRefunded: boolean('application_fee_refunded').notNull(),
    componentId: varchar('component_id', { length: 20 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    eventId: varchar('event_id', { length: 20 }).notNull(),
    fulfillmentEventId: varchar('fulfillment_event_id', { length: 20 }),
    grossEntitlementAmount: integer('gross_entitlement_amount').notNull(),
    id: varchar('id', { length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    netEntitlementAmount: integer('net_entitlement_amount').notNull(),
    operationKey: varchar('operation_key', { length: 100 }).notNull(),
    operationKind:
      registrationAcquisitionRefundOperationKind('operation_kind').notNull(),
    purchaseId: varchar('purchase_id', { length: 20 }),
    quantity: integer('quantity').notNull(),
    refundAmount: integer('refund_amount').notNull(),
    refundTransactionId: varchar('refund_transaction_id', {
      length: 20,
    }).notNull(),
    registrationId: varchar('registration_id', { length: 20 }).notNull(),
    stripeFeeAmount: integer('stripe_fee_amount').notNull(),
    tenantId: varchar('tenant_id', { length: 20 }).notNull(),
  },
  (table) => ({
    acquisitionOwner: foreignKey({
      columns: [
        table.acquisitionId,
        table.eventId,
        table.registrationId,
        table.tenantId,
      ],
      foreignColumns: [
        registrationAcquisitions.id,
        registrationAcquisitions.eventId,
        registrationAcquisitions.registrationId,
        registrationAcquisitions.tenantId,
      ],
      name: 'registration_acquisition_refund_acquisition_fk',
    }),
    amountShape: check(
      'registration_acquisition_refund_amount_shape',
      sql`${table.quantity} > 0 AND ${table.refundAmount} > 0 AND ${table.grossEntitlementAmount} > 0 AND ${table.netEntitlementAmount} >= 0 AND ${table.stripeFeeAmount} >= 0 AND ${table.applicationFeeAmount} >= 0 AND ${table.netEntitlementAmount} + ${table.stripeFeeAmount} + ${table.applicationFeeAmount} = ${table.grossEntitlementAmount}`,
    ),
    componentOperationUnique: unique(
      'registration_acquisition_refund_component_operation_unique',
    ).on(table.componentId, table.operationKey),
    componentOwner: foreignKey({
      columns: [
        table.componentId,
        table.acquisitionPaymentId,
        table.acquisitionId,
        table.tenantId,
      ],
      foreignColumns: [
        registrationAcquisitionComponents.id,
        registrationAcquisitionComponents.acquisitionPaymentId,
        registrationAcquisitionComponents.acquisitionId,
        registrationAcquisitionComponents.tenantId,
      ],
      name: 'registration_acquisition_refund_component_fk',
    }),
    eventOwner: foreignKey({
      columns: [
        table.fulfillmentEventId,
        table.purchaseId,
        table.eventId,
        table.registrationId,
        table.tenantId,
      ],
      foreignColumns: [
        eventRegistrationAddonFulfillmentEvents.id,
        eventRegistrationAddonFulfillmentEvents.purchaseId,
        eventRegistrationAddonFulfillmentEvents.eventId,
        eventRegistrationAddonFulfillmentEvents.registrationId,
        eventRegistrationAddonFulfillmentEvents.tenantId,
      ],
      name: 'registration_acquisition_refund_event_fk',
    }),
    operationKeyShape: check(
      'registration_acquisition_refund_operation_key_shape',
      sql`length(trim(${table.operationKey})) BETWEEN 1 AND 100`,
    ),
    operationShape: check(
      'registration_acquisition_refund_operation_shape',
      sql`(${table.operationKind} = 'registration_cancellation' AND ${table.fulfillmentEventId} IS NULL AND ${table.purchaseId} IS NULL) OR (${table.operationKind} = 'addon_cancellation' AND ${table.fulfillmentEventId} IS NOT NULL AND ${table.purchaseId} IS NOT NULL)`,
    ),
    policyAmount: check(
      'registration_acquisition_refund_policy_amount',
      sql`(${table.applicationFeeRefunded} AND ${table.refundAmount} = ${table.grossEntitlementAmount}) OR (NOT ${table.applicationFeeRefunded} AND ${table.refundAmount} = ${table.netEntitlementAmount})`,
    ),
    refundComponentUnique: unique(
      'registration_acquisition_refund_transaction_component_unique',
    ).on(table.refundTransactionId, table.componentId),
    refundOwner: foreignKey({
      columns: [
        table.refundTransactionId,
        table.registrationId,
        table.tenantId,
      ],
      foreignColumns: [
        transactions.id,
        transactions.eventRegistrationId,
        transactions.tenantId,
      ],
      name: 'registration_acquisition_refund_transaction_fk',
    }),
  }),
);

/** Tenant-scoped proof that a transfer refund plan belongs to one source epoch payment. */
export const registrationTransferRefundPlanAcquisitionLinks = pgTable(
  'registration_transfer_refund_plan_acquisition_links',
  {
    planItemId: varchar('plan_item_id', { length: 20 }).primaryKey(),
    sourceAcquisitionId: varchar('source_acquisition_id', {
      length: 20,
    }).notNull(),
    sourceAcquisitionPaymentId: varchar('source_acquisition_payment_id', {
      length: 20,
    }).notNull(),
    sourceTransactionId: varchar('source_transaction_id', {
      length: 20,
    }).notNull(),
    tenantId: varchar('tenant_id', { length: 20 }).notNull(),
  },
  (table) => ({
    paymentOwner: foreignKey({
      columns: [
        table.sourceAcquisitionPaymentId,
        table.sourceTransactionId,
        table.sourceAcquisitionId,
        table.tenantId,
      ],
      foreignColumns: [
        registrationAcquisitionPayments.id,
        registrationAcquisitionPayments.transactionId,
        registrationAcquisitionPayments.acquisitionId,
        registrationAcquisitionPayments.tenantId,
      ],
      name: 'registration_transfer_refund_plan_acquisition_payment_fk',
    }),
    planOwner: foreignKey({
      columns: [table.planItemId, table.sourceTransactionId, table.tenantId],
      foreignColumns: [
        registrationTransferRefundPlanItems.id,
        registrationTransferRefundPlanItems.sourceTransactionId,
        registrationTransferRefundPlanItems.tenantId,
      ],
      name: 'registration_transfer_refund_plan_acquisition_plan_fk',
    }),
  }),
);
