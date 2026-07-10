import type { DatabaseClient } from '@db/index';

import { tenants, transactions } from '@db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';

export const pendingStripeObligationPredicate = (tenantId: string) =>
  and(
    eq(transactions.method, 'stripe'),
    eq(transactions.status, 'pending'),
    eq(transactions.tenantId, tenantId),
    inArray(transactions.type, ['registration', 'refund']),
  );

/**
 * A pending registration Checkout or registration refund is owned by its
 * persisted Connect account. Account changes stay blocked until every such
 * obligation reaches a durable terminal outcome.
 */
export const tenantHasPendingStripeObligations = Effect.fn(
  'tenantHasPendingStripeObligations',
)(function* (database: Pick<DatabaseClient, 'select'>, tenantId: string) {
  const obligations = yield* database
    .select({ id: transactions.id })
    .from(transactions)
    .where(pendingStripeObligationPredicate(tenantId))
    .limit(1);

  return obligations.length > 0;
});

export const lockTenantStripeAccount = Effect.fn('lockTenantStripeAccount')(
  function* (database: Pick<DatabaseClient, 'select'>, tenantId: string) {
    const rows = yield* database
      .select({ stripeAccountId: tenants.stripeAccountId })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .for('update');

    return rows[0]?.stripeAccountId;
  },
);
