import { describe, expect, it } from '@effect/vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import { pendingStripeObligationPredicate } from './pending-stripe-obligations';

const normalizeSql = (statement: string): string =>
  statement.replaceAll(/\s+/g, ' ').trim();

describe('pending Stripe obligations', () => {
  it('includes pending registration, add-on, and refund obligations for one tenant', () => {
    const query = new PgDialect().sqlToQuery(
      pendingStripeObligationPredicate('tenant-1'),
    );
    const statement = normalizeSql(query.sql);

    expect(statement).toContain('"transactions"."method" =');
    expect(statement).toContain('"transactions"."status" =');
    expect(statement).toContain('"transactions"."tenantId" =');
    expect(statement).toContain('"transactions"."type" in');
    expect(query.params).toEqual([
      'stripe',
      'pending',
      'tenant-1',
      'registration',
      'refund',
      'addon',
    ]);
  });
});
