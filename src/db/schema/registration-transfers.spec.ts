import { describe, expect, it } from '@effect/vitest';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import {
  activeRegistrationTransferSourceUniqueIndexName,
  registrationTransferEvents,
  registrationTransferExpiryIndexName,
  registrationTransfers,
} from './registration-transfers';

describe('registration transfer schema', () => {
  it('allows only one active offer for a source registration', () => {
    const tableConfig = getTableConfig(registrationTransfers);
    const activeSourceIndex = tableConfig.indexes.find(
      (index) =>
        index.config.name === activeRegistrationTransferSourceUniqueIndexName,
    );

    expect(activeSourceIndex?.config.unique).toBe(true);
    expect(
      activeSourceIndex?.config.columns.map((column) => column.name),
    ).toEqual(['source_registration_id']);
    const predicate = activeSourceIndex?.config.where;
    expect(predicate).toBeDefined();
    if (!predicate) {
      throw new Error('Expected active transfer source predicate');
    }
    expect(new PgDialect().sqlToQuery(predicate).sql).toBe(
      `"registration_transfers"."status" IN ('open', 'checkout_pending', 'refund_pending', 'refund_failed')`,
    );
  });

  it('stores only claim hashes and indexes expirable offers', () => {
    const tableConfig = getTableConfig(registrationTransfers);
    const columnNames = tableConfig.columns.map((column) => column.name);
    const expiryIndex = tableConfig.indexes.find(
      (index) => index.config.name === registrationTransferExpiryIndexName,
    );

    expect(columnNames).toContain('claim_token_hash');
    expect(columnNames).toContain('claim_code_hash');
    expect(columnNames).not.toContain('claim_token');
    expect(columnNames).not.toContain('claim_code');
    expect(expiryIndex?.config.columns.map((column) => column.name)).toEqual([
      'status',
      'expires_at',
    ]);
  });

  it('persists capacity, payment, refund, and lifecycle ownership', () => {
    const tableConfig = getTableConfig(registrationTransfers);

    expect(tableConfig.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'recipient_checkout_transaction_id',
        'recipient_registration_id',
        'recipient_spot_count',
        'refund_transaction_id',
        'reserved_additional_spots',
        'source_payment_transaction_id',
        'source_refund_amount',
        'source_refund_application_fee',
        'source_registration_id',
        'source_spot_count',
      ]),
    );
    expect(tableConfig.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'registration_transfers_recipient_spot_count_positive',
        'registration_transfers_reserved_spots_nonnegative',
        'registration_transfers_source_refund_nonnegative',
        'registration_transfers_source_spot_count_positive',
      ]),
    );
    expect(
      tableConfig.foreignKeys.map((foreignKey) => foreignKey.getName()),
    ).toContain('registration_transfers_option_event_fk');
  });

  it('keeps transfer history append-only and ordered per transfer', () => {
    const tableConfig = getTableConfig(registrationTransferEvents);

    expect(tableConfig.columns.map((column) => column.name)).not.toContain(
      'updated_at',
    );
    expect(
      tableConfig.indexes.map((index) => ({
        columns: index.config.columns.map((column) => column.name),
        name: index.config.name,
      })),
    ).toEqual([
      {
        columns: ['transfer_id', 'created_at'],
        name: 'registration_transfer_events_transfer_idx',
      },
    ]);
  });
});
