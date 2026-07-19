import { getTableConfig } from 'drizzle-orm/pg-core';
import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { eventRegistrationOptions as eventRegistrationOptionsTable } from './event-registration-options';

import { templateRegistrationOptions } from './template-registration-options';
import { tenants } from './tenants';

type EventRegistrationOptionInsert =
  typeof eventRegistrationOptionsTable.$inferInsert;

const columnByName = (
  table: Parameters<typeof getTableConfig>[0],
  name: string,
) => getTableConfig(table).columns.find((column) => column.name === name);

describe('registration policy settings schema', () => {
  it('gives every tenant explicit non-null policy defaults', () => {
    expect(
      columnByName(tenants, 'transfer_deadline_hours_before_start'),
    ).toMatchObject({ default: 0, notNull: true });
    expect(
      columnByName(tenants, 'cancellation_deadline_hours_before_start'),
    ).toMatchObject({ default: 120, notNull: true });
    expect(columnByName(tenants, 'refund_fees_on_cancellation')).toMatchObject({
      default: true,
      notNull: true,
    });
    expect(
      getTableConfig(tenants).checks.map((constraint) => constraint.name),
    ).toEqual(
      expect.arrayContaining([
        'tenants_cancellation_deadline_hours_nonnegative',
        'tenants_transfer_deadline_hours_nonnegative',
      ]),
    );
  });

  it('stores nullable template registration-option overrides with nonnegative deadline checks', () => {
    expect(
      columnByName(
        templateRegistrationOptions,
        'transfer_deadline_hours_before_start',
      ),
    ).toMatchObject({ notNull: false });
    expect(
      columnByName(
        templateRegistrationOptions,
        'cancellation_deadline_hours_before_start',
      ),
    ).toMatchObject({ notNull: false });
    expect(
      columnByName(templateRegistrationOptions, 'refund_fees_on_cancellation'),
    ).toMatchObject({ notNull: false });
    expect(
      getTableConfig(templateRegistrationOptions).checks.map(
        (constraint) => constraint.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        'template_registration_options_cancellation_deadline_hours_nonne',
        'template_registration_options_transfer_deadline_hours_nonnegati',
      ]),
    );
  });

  it('keeps event registration-option overrides nullable and database constrained', () => {
    expectTypeOf<
      EventRegistrationOptionInsert['transferDeadlineHoursBeforeStart']
    >().toEqualTypeOf<null | number | undefined>();
    expectTypeOf<
      EventRegistrationOptionInsert['cancellationDeadlineHoursBeforeStart']
    >().toEqualTypeOf<null | number | undefined>();
    expectTypeOf<
      EventRegistrationOptionInsert['refundFeesOnCancellation']
    >().toEqualTypeOf<boolean | null | undefined>();

    const source = readFileSync(
      new URL('event-registration-options.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      'event_registration_options_cancellation_deadline_hours_nonnegat',
    );
    expect(source).toContain(
      'event_registration_options_transfer_deadline_hours_nonnegative',
    );
    expect(source).toContain('refund_fees_on_cancellation');
  });
});
