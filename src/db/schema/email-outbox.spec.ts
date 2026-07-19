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

  it('stores and indexes nullable delivery claim leases', () => {
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

    expect(claimLeaseIdColumn?.getSQLType()).toBe('text');
    expect(claimLeaseIdColumn?.notNull).toBe(false);
    expect(claimLeaseExpiryColumn?.getSQLType()).toBe('timestamp');
    expect(claimLeaseExpiryColumn?.notNull).toBe(false);
    expect(
      claimLeaseIndex?.config.columns.map((column) => column.name),
    ).toEqual(['status', 'claim_lease_expires_at']);
  });
});
