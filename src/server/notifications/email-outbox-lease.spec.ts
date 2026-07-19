import { describe, expect, it } from '@effect/vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  EMAIL_OUTBOX_CLAIM_LEASE_MS,
  emailOutboxClaimableByIdPredicate,
  emailOutboxClaimablePredicate,
  emailOutboxClaimAttempts,
  emailOutboxClaimLeaseExpiry,
  emailOutboxOwnedClaimPredicate,
  emailOutboxStaleSendingPredicate,
} from './email-outbox-lease';

const dialect = new PgDialect();
const normalizeSql = (statement: string): string =>
  statement.replaceAll(/\s+/g, ' ').trim();

describe('email outbox lease predicates', () => {
  it('claims due retries and expired or legacy sending leases', () => {
    const query = dialect.sqlToQuery(emailOutboxClaimablePredicate());
    const statement = normalizeSql(query.sql);

    expect(statement).toContain('"email_outbox"."exhausted_at" is null');
    expect(statement).toContain(
      '"email_outbox"."status" in (\'queued\', \'failed\')',
    );
    expect(statement).toContain('"email_outbox"."next_attempt_at" <= now()');
    expect(statement).toContain(
      '"email_outbox"."attempts" < "email_outbox"."max_attempts"',
    );
    expect(statement).toContain('"email_outbox"."status" = \'sending\'');
    expect(statement).toContain(
      '"email_outbox"."claim_lease_expires_at" is null or "email_outbox"."claim_lease_expires_at" <= now()',
    );
    expect(query.params).toEqual([]);
  });

  it('uses the same atomic eligibility predicate when claiming a selected row', () => {
    const query = dialect.sqlToQuery(
      emailOutboxClaimableByIdPredicate('email-1'),
    );
    const statement = normalizeSql(query.sql);

    expect(statement).toContain('"email_outbox"."id" = $1');
    expect(statement).toContain(
      '"email_outbox"."claim_lease_expires_at" <= now()',
    );
    expect(query.params).toEqual(['email-1']);
  });

  it('reclaims an unfinished attempt without consuming another retry', () => {
    const attemptsQuery = dialect.sqlToQuery(emailOutboxClaimAttempts());
    const leaseQuery = dialect.sqlToQuery(emailOutboxClaimLeaseExpiry());

    expect(normalizeSql(attemptsQuery.sql)).toBe(
      'case when "email_outbox"."status" = \'sending\' then "email_outbox"."attempts" else "email_outbox"."attempts" + 1 end',
    );
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

  it('reports sending rows as stale when their lease is missing or expired', () => {
    const query = dialect.sqlToQuery(emailOutboxStaleSendingPredicate());
    const statement = normalizeSql(query.sql);

    expect(statement).toContain('"email_outbox"."status" = \'sending\'');
    expect(statement).toContain(
      '"email_outbox"."claim_lease_expires_at" is null or "email_outbox"."claim_lease_expires_at" <= now()',
    );
  });
});
