import { describe, expect, it } from '@effect/vitest';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { readFileSync } from 'node:fs';

import {
  activeEventRegistrationUniqueIndexName,
  eventRegistrations,
} from './index';

describe('event registration schema', () => {
  it('does not expose legacy paymentStatus state', () => {
    const eventRegistrationsSource = readFileSync(
      new URL('event-registrations.ts', import.meta.url),
      'utf8',
    );
    const globalEnumsSource = readFileSync(
      new URL('global-enums.ts', import.meta.url),
      'utf8',
    );

    expect(eventRegistrationsSource).not.toContain('paymentStatus');
    expect(globalEnumsSource).not.toContain('paymentStatus');
    expect(globalEnumsSource).not.toContain("pgEnum('payment_status'");
  });

  it('stores participant guest quantity on the registration row', () => {
    const eventRegistrationsSource = readFileSync(
      new URL('event-registrations.ts', import.meta.url),
      'utf8',
    );

    expect(eventRegistrationsSource).toContain(
      "guestCount: integer('guest_count')",
    );
    expect(eventRegistrationsSource).toContain('.notNull().default(0)');
  });

  it('stores partial guest check-in progress on the registration row', () => {
    const eventRegistrationsSource = readFileSync(
      new URL('event-registrations.ts', import.meta.url),
      'utf8',
    );

    expect(eventRegistrationsSource).toContain(
      "checkedInGuestCount: integer('checked_in_guest_count')",
    );
    expect(eventRegistrationsSource).toContain('.notNull().default(0)');
  });

  it('enforces one non-cancelled registration per globally identified event and user', () => {
    const eventRegistrationsSource = readFileSync(
      new URL('event-registrations.ts', import.meta.url),
      'utf8',
    );

    expect(eventRegistrationsSource).toContain(
      "'event_registrations_active_user_event_unique'",
    );
    expect(eventRegistrationsSource).toContain(
      '.on(table.eventId, table.userId)',
    );
    expect(eventRegistrationsSource).not.toContain(
      '.on(table.tenantId, table.eventId, table.userId)',
    );
    expect(eventRegistrationsSource).toContain(
      ".where(sql`${table.status} <> 'CANCELLED'`)",
    );
  });

  it('indexes active registrations by tenant and user for membership-scoped locking', () => {
    const eventRegistrationsSource = readFileSync(
      new URL('event-registrations.ts', import.meta.url),
      'utf8',
    );

    expect(eventRegistrationsSource).toContain(
      "'event_registrations_active_tenant_user_idx'",
    );
    expect(eventRegistrationsSource).toContain(
      '.on(table.tenantId, table.userId)',
    );
    expect(eventRegistrationsSource).toContain(
      ".where(sql`${table.status} <> 'CANCELLED'`)",
    );
  });

  it('enforces one pending payment claim per globally identified registration', () => {
    const transactionsSource = readFileSync(
      new URL('transactions.ts', import.meta.url),
      'utf8',
    );

    expect(transactionsSource).toContain(
      "'transactions_pending_registration_unique'",
    );
    expect(transactionsSource).toContain('.on(table.eventRegistrationId)');
    expect(transactionsSource).not.toContain(
      '.on(table.tenantId, table.eventRegistrationId)',
    );
    expect(transactionsSource).toContain(
      "${table.status} = 'pending' AND ${table.type} = 'registration' AND ${table.eventRegistrationId} IS NOT NULL",
    );
    expect(transactionsSource).toContain(
      'stripeCheckoutCancellationRequestedAt: timestamp(',
    );
    expect(transactionsSource).toContain(
      "'stripe_checkout_cancellation_requested_at'",
    );
  });

  it('indexes registration transactions by tenant, registration, and type', () => {
    const transactionsSource = readFileSync(
      new URL('transactions.ts', import.meta.url),
      'utf8',
    );

    expect(transactionsSource).toContain(
      "'transactions_tenant_event_registration_type_idx'",
    );
    expect(transactionsSource).toContain(
      '.on(table.tenantId, table.eventRegistrationId, table.type)',
    );
    expect(transactionsSource).toContain(
      '.where(sql`${table.eventRegistrationId} IS NOT NULL`)',
    );
  });

  it('models the active-registration invariant as a partial global event-user index', () => {
    const tableConfig = getTableConfig(eventRegistrations);
    const activeRegistrationIndex = tableConfig.indexes.find(
      (index) => index.config.name === activeEventRegistrationUniqueIndexName,
    );

    expect(activeRegistrationIndex).toBeDefined();
    expect(activeRegistrationIndex?.config.unique).toBe(true);
    expect(
      activeRegistrationIndex?.config.columns.map((column) => column.name),
    ).toEqual(['eventId', 'userId']);

    const predicate = activeRegistrationIndex?.config.where;
    expect(predicate).toBeDefined();
    if (!predicate) {
      throw new Error('Expected active registration index predicate');
    }
    expect(new PgDialect().sqlToQuery(predicate).sql).toBe(
      `"event_registrations"."status" <> 'CANCELLED'`,
    );
  });
});
