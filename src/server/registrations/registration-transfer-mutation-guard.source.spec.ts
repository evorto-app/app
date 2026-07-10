import { PgDialect } from 'drizzle-orm/pg-core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { activeRegistrationTransferMutationPredicate } from './registration-transfer-mutation-guard';

const source = readFileSync(
  new URL('registration-transfer-mutation-guard.ts', import.meta.url),
  'utf8',
);

describe('registration transfer mutation guard source', () => {
  it('locks every active source state but only a pending recipient checkout', () => {
    expect(source).toContain('activeRegistrationTransferStatuses');
    expect(source).toContain('registrationTransfers.sourceRegistrationId');
    expect(source).toContain('registrationTransfers.recipientRegistrationId');
    expect(source).toContain(
      "eq(registrationTransfers.status, 'checkout_pending')",
    );
    expect(source).toContain(".for('update')");
    expect(source).toContain('RegistrationTransferMutationConflict');
  });

  it('does not freeze a confirmed recipient while the source refund is pending', () => {
    const query = new PgDialect().sqlToQuery(
      activeRegistrationTransferMutationPredicate({
        registrationId: 'registration-1',
        tenantId: 'tenant-1',
      }),
    );

    expect(query.sql).toContain('"source_registration_id" =');
    expect(query.sql).toContain('"recipient_registration_id" =');
    expect(query.params).toEqual([
      'tenant-1',
      'registration-1',
      'open',
      'checkout_pending',
      'refund_pending',
      'refund_failed',
      'registration-1',
      'checkout_pending',
    ]);
  });
});
