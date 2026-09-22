import { describe, expect, it } from '@effect/vitest';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { emailOutbox, emailOutboxKind } from './email-outbox';

describe('email outbox schema', () => {
  it('stores every durable producer kind in the typed enum', () => {
    expect(emailOutboxKind.enumValues).toEqual([
      'manualApproval',
      'receiptReviewed',
      'registrationCancelled',
      'registrationConfirmed',
      'registrationTransferred',
      'waitlistSpotAvailable',
    ]);
  });

  it('stores claim leases and indexes the single-dispatch state', () => {
    const tableConfig = getTableConfig(emailOutbox);
    const claimLeaseIdColumn = tableConfig.columns.find(
      (column) => column.name === 'claim_lease_id',
    );
    const claimLeaseExpiryColumn = tableConfig.columns.find(
      (column) => column.name === 'claim_lease_expires_at',
    );
    const claimLeaseIndex = tableConfig.indexes.find(
      (index) => index.config.name === 'email_outbox_claim_lease_idx',
    );
    const dispatchIndex = tableConfig.indexes.find(
      (index) => index.config.name === 'email_outbox_dispatch_idx',
    );
    const overviewIndex = tableConfig.indexes.find(
      (index) => index.config.name === 'email_outbox_overview_idx',
    );
    const singleDispatchCheck = tableConfig.checks.find(
      (check) => check.name === 'email_outbox_single_dispatch_attempts_check',
    );

    expect(claimLeaseIdColumn?.getSQLType()).toBe('text');
    expect(claimLeaseIdColumn?.notNull).toBe(false);
    expect(claimLeaseExpiryColumn?.getSQLType()).toBe('timestamp');
    expect(claimLeaseExpiryColumn?.notNull).toBe(false);
    expect(
      claimLeaseIndex?.config.columns.map((column) =>
        'name' in column ? column.name : undefined,
      ),
    ).toEqual(['status', 'claim_lease_expires_at']);
    expect(
      dispatchIndex?.config.columns.map((column) =>
        'name' in column ? column.name : undefined,
      ),
    ).toEqual(['status', 'attempts', 'createdAt']);
    expect(
      tableConfig.columns.some((column) => column.name === 'max_attempts'),
    ).toBe(false);
    expect(
      tableConfig.columns.some((column) => column.name === 'next_attempt_at'),
    ).toBe(false);
    expect(
      tableConfig.columns.some((column) => column.name === 'exhausted_at'),
    ).toBe(false);
    expect(
      tableConfig.columns.some((column) => column.name === 'from_email'),
    ).toBe(false);
    expect(
      tableConfig.columns.some((column) => column.name === 'from_name'),
    ).toBe(false);
    expect(overviewIndex?.config.columns).toMatchObject([
      { indexConfig: { nulls: 'last', order: 'asc' }, name: 'status' },
      { indexConfig: { nulls: 'first', order: 'desc' }, name: 'updatedAt' },
      { indexConfig: { nulls: 'last', order: 'asc' }, name: 'id' },
    ]);
    expect(singleDispatchCheck).toBeDefined();
  });

  it('indexes incomplete terminal diagnostics separately from ordinary sent history', () => {
    const incompleteIndex = getTableConfig(emailOutbox).indexes.find(
      (index) => index.config.name === 'email_outbox_incomplete_terminal_idx',
    );
    expect(incompleteIndex?.config.columns).toMatchObject([
      { indexConfig: { nulls: 'last', order: 'asc' }, name: 'status' },
      { indexConfig: { nulls: 'first', order: 'desc' }, name: 'updatedAt' },
      { indexConfig: { nulls: 'last', order: 'asc' }, name: 'id' },
    ]);
    const predicate = incompleteIndex?.config.where;
    if (!predicate)
      throw new Error('Expected the incomplete-terminal index predicate');
    const statement = new PgDialect()
      .sqlToQuery(predicate)
      .sql.replaceAll(/\s+/g, ' ')
      .trim();
    expect(statement).toContain(
      '"email_outbox"."status" = \'sent\' and "email_outbox"."sent_at" is null',
    );
    expect(statement).toContain(
      '"email_outbox"."status" = \'suppressed\' and ("email_outbox"."suppressed_at" is null or "email_outbox"."last_attempt_at" is null)',
    );
  });
});
