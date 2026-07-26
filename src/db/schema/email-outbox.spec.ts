import { describe, expect, it } from '@effect/vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

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
    const singleDispatchCheck = tableConfig.checks.find(
      (check) => check.name === 'email_outbox_single_dispatch_attempts_check',
    );

    expect(claimLeaseIdColumn?.getSQLType()).toBe('text');
    expect(claimLeaseIdColumn?.notNull).toBe(false);
    expect(claimLeaseExpiryColumn?.getSQLType()).toBe('timestamp');
    expect(claimLeaseExpiryColumn?.notNull).toBe(false);
    expect(
      claimLeaseIndex?.config.columns.map((column) => column.name),
    ).toEqual(['status', 'claim_lease_expires_at']);
    expect(dispatchIndex?.config.columns.map((column) => column.name)).toEqual([
      'status',
      'attempts',
      'createdAt',
    ]);
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
    expect(singleDispatchCheck).toBeDefined();
  });
});
