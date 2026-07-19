import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';

import type { DatabaseClient } from '../db';
import type { Tenant } from '../types/custom/tenant';

import { tenants } from '../db/schema';

type TenantCurrencyDependentDataDatabase = Pick<DatabaseClient, 'query'>;
type TenantCurrencyLockDatabase = Pick<DatabaseClient, 'select'>;

export const lockTenantCurrencyForFinancialConfiguration = Effect.fn(
  'TenantCurrencyIntegrity.lockTenantCurrencyForFinancialConfiguration',
)(function* (
  database: TenantCurrencyLockDatabase,
  tenantId: string,
  expectedCurrency: Tenant['currency'],
) {
  const tenantRows = yield* database
    .select({ currency: tenants.currency, id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .for('update');
  const tenant = tenantRows[0];
  if (!tenant) {
    return yield* new RpcBadRequestError({
      message: 'Tenant was not found while saving financial configuration',
      reason: 'tenantNotFoundForCurrencyLock',
    });
  }
  if (tenant.currency !== expectedCurrency) {
    return yield* new RpcBadRequestError({
      message:
        'Tenant currency changed while this financial configuration was being prepared',
      reason: `Refresh and review every amount in ${tenant.currency} before retrying.`,
    });
  }

  return tenant.currency;
});

/**
 * Currency is only a default while a tenant has no currency-dependent records.
 * Templates and events store minor-unit prices without their own currency, while
 * receipts and transactions retain an explicit recorded currency.
 */
export const tenantHasCurrencyDependentData = Effect.fn(
  'TenantCurrencyIntegrity.tenantHasCurrencyDependentData',
)(function* (database: TenantCurrencyDependentDataDatabase, tenantId: string) {
  const existingTemplate = yield* database.query.eventTemplates.findFirst({
    columns: { id: true },
    where: { tenantId },
  });
  if (existingTemplate) {
    return true;
  }

  const existingEvent = yield* database.query.eventInstances.findFirst({
    columns: { id: true },
    where: { tenantId },
  });
  if (existingEvent) {
    return true;
  }

  const existingReceipt = yield* database.query.financeReceipts.findFirst({
    columns: { id: true },
    where: { tenantId },
  });
  if (existingReceipt) {
    return true;
  }

  const existingTransaction = yield* database.query.transactions.findFirst({
    columns: { id: true },
    where: { tenantId },
  });

  return Boolean(existingTransaction);
});

export const tenantCurrencyChangeBlockedErrorDetails = {
  message: 'Tenant currency is locked by existing financial configuration',
  reason:
    'Currency cannot change after template, event, receipt, or transaction data exists. A dedicated currency migration is required.',
} as const;
