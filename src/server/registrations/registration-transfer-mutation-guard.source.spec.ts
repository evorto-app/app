import { PgDialect } from 'drizzle-orm/pg-core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { activeRegistrationTransferMutationPredicate } from './registration-transfer-mutation-guard';

const source = readFileSync(
  new URL('registration-transfer-mutation-guard.ts', import.meta.url),
  'utf8',
);

describe('registration transfer mutation guard source', () => {
  it('locks only offers and recipient checkouts before ownership moves', () => {
    expect(source).toContain('registrationTransferMutationBlockingStatuses');
    expect(source).toContain('registrationTransfers.sourceRegistrationId');
    expect(source).not.toContain(
      'registrationTransfers.recipientRegistrationId',
    );
    expect(source).toContain("'checkout_pending',");
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
    expect(query.sql).not.toContain('"recipient_registration_id" =');
    expect(query.params).toEqual([
      'tenant-1',
      'registration-1',
      'open',
      'checkout_pending',
    ]);
  });
});
