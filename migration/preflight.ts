import { count, eq, or } from 'drizzle-orm';

import * as oldSchema from '../old/drizzle';
import { oldDatabase } from './migrator-database';

export interface UnsupportedLegacyHistoryCounts {
  readonly collectedFees: number;
  readonly costItems: number;
  readonly eventSubmissionItems: number;
  readonly lineItems: number;
  readonly receipts: number;
  readonly registrations: number;
  readonly transactions: number;
}

export const assertLegacyHistoryMigrationSupported = (
  tenantLabel: string,
  counts: UnsupportedLegacyHistoryCounts,
) => {
  if (
    counts.collectedFees === 0 &&
    counts.costItems === 0 &&
    counts.eventSubmissionItems === 0 &&
    counts.lineItems === 0 &&
    counts.receipts === 0 &&
    counts.registrations === 0 &&
    counts.transactions === 0
  ) {
    return;
  }

  throw new Error(
    `Legacy tenant ${tenantLabel} has ${counts.registrations} registrations, ${counts.transactions} transactions, ${counts.lineItems} product line items, ${counts.collectedFees} collected fees, ${counts.costItems} cost items, ${counts.receipts} receipts, and ${counts.eventSubmissionItems} event submission items, but this importer does not preserve registration, payment, refund, add-on, fulfillment, reimbursement, or submission-question history. Production cutover is blocked until a dedicated history importer and reconciliation are implemented.`,
  );
};

export const preflightLegacyTenant = async (tenant: {
  readonly id: string;
  readonly shortName: string;
}) => {
  const registrationRows = await oldDatabase
    .select({ count: count() })
    .from(oldSchema.eventRegistration)
    .innerJoin(
      oldSchema.tumiEvent,
      eq(oldSchema.eventRegistration.eventId, oldSchema.tumiEvent.id),
    )
    .innerJoin(
      oldSchema.eventTemplate,
      eq(oldSchema.tumiEvent.eventTemplateId, oldSchema.eventTemplate.id),
    )
    .where(eq(oldSchema.eventTemplate.tenantId, tenant.id));
  const collectedFeeRows = await oldDatabase
    .select({ count: count() })
    .from(oldSchema.collectedFee)
    .where(eq(oldSchema.collectedFee.tenantId, tenant.id));
  const costItemRows = await oldDatabase
    .select({ count: count() })
    .from(oldSchema.costItem)
    .innerJoin(
      oldSchema.tumiEvent,
      eq(oldSchema.costItem.eventId, oldSchema.tumiEvent.id),
    )
    .innerJoin(
      oldSchema.eventTemplate,
      eq(oldSchema.tumiEvent.eventTemplateId, oldSchema.eventTemplate.id),
    )
    .where(eq(oldSchema.eventTemplate.tenantId, tenant.id));
  const eventSubmissionItemRows = await oldDatabase
    .select({ count: count() })
    .from(oldSchema.eventSubmissionItem)
    .leftJoin(
      oldSchema.tumiEvent,
      eq(oldSchema.eventSubmissionItem.eventId, oldSchema.tumiEvent.id),
    )
    .leftJoin(
      oldSchema.eventTemplate,
      eq(oldSchema.tumiEvent.eventTemplateId, oldSchema.eventTemplate.id),
    )
    .leftJoin(
      oldSchema.product,
      eq(oldSchema.eventSubmissionItem.productId, oldSchema.product.id),
    )
    .where(
      or(
        eq(oldSchema.eventTemplate.tenantId, tenant.id),
        eq(oldSchema.product.tenantId, tenant.id),
      ),
    );
  const lineItemRows = await oldDatabase
    .select({ count: count() })
    .from(oldSchema.lineItem)
    .innerJoin(
      oldSchema.product,
      eq(oldSchema.lineItem.productId, oldSchema.product.id),
    )
    .where(eq(oldSchema.product.tenantId, tenant.id));
  const receiptRows = await oldDatabase
    .select({ count: count() })
    .from(oldSchema.receipt)
    .innerJoin(
      oldSchema.costItem,
      eq(oldSchema.receipt.costItemId, oldSchema.costItem.id),
    )
    .innerJoin(
      oldSchema.tumiEvent,
      eq(oldSchema.costItem.eventId, oldSchema.tumiEvent.id),
    )
    .innerJoin(
      oldSchema.eventTemplate,
      eq(oldSchema.tumiEvent.eventTemplateId, oldSchema.eventTemplate.id),
    )
    .where(eq(oldSchema.eventTemplate.tenantId, tenant.id));
  const transactionRows = await oldDatabase
    .select({ count: count() })
    .from(oldSchema.transaction)
    .where(eq(oldSchema.transaction.tenantId, tenant.id));

  assertLegacyHistoryMigrationSupported(tenant.shortName, {
    collectedFees: collectedFeeRows[0]?.count ?? 0,
    costItems: costItemRows[0]?.count ?? 0,
    eventSubmissionItems: eventSubmissionItemRows[0]?.count ?? 0,
    lineItems: lineItemRows[0]?.count ?? 0,
    receipts: receiptRows[0]?.count ?? 0,
    registrations: registrationRows[0]?.count ?? 0,
    transactions: transactionRows[0]?.count ?? 0,
  });
};
