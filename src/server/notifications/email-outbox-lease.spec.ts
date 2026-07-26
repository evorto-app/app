import { describe, expect, it } from '@effect/vitest';
import { EMAIL_DELIVERY_REQUEST_TIMEOUT_MS } from '@server/integrations/email-delivery';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  EMAIL_OUTBOX_CLAIM_LEASE_MS,
  emailOutboxAbandonedSendingPredicate,
  emailOutboxClaimLeaseExpiry,
  emailOutboxDispatchableByIdPredicate,
  emailOutboxDispatchablePredicate,
  emailOutboxOperationalIncidentPredicate,
  emailOutboxOverviewOrderBy,
  emailOutboxOwnedClaimPredicate,
} from './email-outbox-lease';

const dialect = new PgDialect();
const normalizeSql = (statement: string): string =>
  statement.replaceAll(/\s+/g, ' ').trim();

describe('email outbox lease predicates', () => {
  it('keeps the provider deadline well below the claim lease', () => {
    expect(EMAIL_DELIVERY_REQUEST_TIMEOUT_MS).toBeLessThan(
      EMAIL_OUTBOX_CLAIM_LEASE_MS / 2,
    );
  });

  it('dispatches only queued rows that have never been attempted', () => {
    const query = dialect.sqlToQuery(emailOutboxDispatchablePredicate());
    const statement = normalizeSql(query.sql);

    expect(statement).toBe(
      '"email_outbox"."status" = \'queued\' and "email_outbox"."attempts" = 0',
    );
    expect(query.params).toEqual([]);
  });

  it('uses the same atomic eligibility predicate when claiming a selected row', () => {
    const query = dialect.sqlToQuery(
      emailOutboxDispatchableByIdPredicate('email-1'),
    );
    const statement = normalizeSql(query.sql);

    expect(statement).toContain('"email_outbox"."id" = $1');
    expect(statement).toContain('"email_outbox"."status" = \'queued\'');
    expect(statement).toContain('"email_outbox"."attempts" = 0');
    expect(query.params).toEqual(['email-1']);
  });

  it('sets a bounded claim lease for the single provider request', () => {
    const leaseQuery = dialect.sqlToQuery(emailOutboxClaimLeaseExpiry());

    expect(normalizeSql(leaseQuery.sql)).toBe(
      "now() + ($1 * interval '1 millisecond')",
    );
    expect(leaseQuery.params).toEqual([EMAIL_OUTBOX_CLAIM_LEASE_MS]);
  });

  it('fences terminal writes to the worker that owns the current lease', () => {
    const query = dialect.sqlToQuery(
      emailOutboxOwnedClaimPredicate('email-1', 'lease-1'),
    );
    const statement = normalizeSql(query.sql);

    expect(statement).toContain('"email_outbox"."id" = $1');
    expect(statement).toContain('"email_outbox"."status" = \'sending\'');
    expect(statement).toContain('"email_outbox"."claim_lease_id" = $2');
    expect(query.params).toEqual(['email-1', 'lease-1']);
  });

  it('marks missing or expired sending claims as abandoned', () => {
    const query = dialect.sqlToQuery(emailOutboxAbandonedSendingPredicate());
    const statement = normalizeSql(query.sql);

    expect(statement).toContain('"email_outbox"."status" = \'sending\'');
    expect(statement).toContain(
      '"email_outbox"."claim_lease_expires_at" is null or "email_outbox"."claim_lease_expires_at" <= now()',
    );
  });

  it('classifies terminal failures and abandoned claims as operational incidents', () => {
    const query = dialect.sqlToQuery(emailOutboxOperationalIncidentPredicate());
    const statement = normalizeSql(query.sql);

    expect(statement).toContain(
      '"email_outbox"."status" in (\'failed\', \'deliveryUnknown\')',
    );
    expect(statement).toContain('"email_outbox"."status" = \'sending\'');
    expect(statement).toContain(
      '"email_outbox"."claim_lease_expires_at" <= now()',
    );
  });

  it('lists incidents before newer routine outbox rows', () => {
    const statements = emailOutboxOverviewOrderBy().map((expression) =>
      normalizeSql(dialect.sqlToQuery(expression).sql),
    );

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain(
      'case when ( "email_outbox"."status" in (\'failed\', \'deliveryUnknown\')',
    );
    expect(statements[0]).toMatch(/then 0 else 1 end asc$/);
    expect(statements[1]).toBe('"email_outbox"."updatedAt" desc');
    expect(statements[2]).toBe('"email_outbox"."id" asc');
  });
});
