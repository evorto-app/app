import { describe, expect, it } from '@effect/vitest';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import {
  eventDiscountOptionOwnerForeignKeyName,
  eventDiscountOptionTypeUniqueConstraintName,
  eventDiscountPriceNonnegativeCheckName,
  eventRegistrationOptionDiscounts,
  eventRegistrationOptions,
  templateDiscountOptionOwnerForeignKeyName,
  templateDiscountOptionTypeUniqueConstraintName,
  templateDiscountPriceNonnegativeCheckName,
  templateRegistrationOptionDiscounts,
  templateRegistrationOptions,
} from './index';

const expectOwnerForeignKey = ({
  columns,
  foreignColumns,
  foreignTable,
  name,
  table,
}: {
  columns: readonly string[];
  foreignColumns: readonly string[];
  foreignTable: Parameters<typeof getTableConfig>[0];
  name: string;
  table: Parameters<typeof getTableConfig>[0];
}) => {
  const constraint = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name,
  );

  expect(constraint).toBeDefined();
  expect(constraint?.reference().columns.map((column) => column.name)).toEqual(
    columns,
  );
  expect(
    constraint?.reference().foreignColumns.map((column) => column.name),
  ).toEqual(foreignColumns);
  expect(constraint?.reference().foreignTable).toBe(foreignTable);
  expect(constraint?.onDelete).toBe('cascade');
};

const expectUniqueConstraint = ({
  columns,
  name,
  table,
}: {
  columns: readonly string[];
  name: string;
  table: Parameters<typeof getTableConfig>[0];
}) => {
  const constraint = getTableConfig(table).uniqueConstraints.find(
    (candidate) => candidate.getName() === name,
  );

  expect(constraint).toBeDefined();
  expect(constraint?.columns.map((column) => column.name)).toEqual(columns);
};

const expectUniqueColumns = ({
  columns,
  table,
}: {
  columns: readonly string[];
  table: Parameters<typeof getTableConfig>[0];
}) => {
  expect(
    getTableConfig(table).uniqueConstraints.some(
      (constraint) =>
        constraint.columns.map((column) => column.name).join(',') ===
        columns.join(','),
    ),
  ).toBe(true);
};

describe('registration option discount integrity', () => {
  it('binds template discounts to one option owner and discount type', () => {
    const config = getTableConfig(templateRegistrationOptionDiscounts);
    const priceCheck = config.checks.find(
      (constraint) =>
        constraint.name === templateDiscountPriceNonnegativeCheckName,
    );
    const templateId = config.columns.find(
      (column) => column.name === 'templateId',
    );

    expect(templateRegistrationOptionDiscounts.id.primary).toBe(true);
    expect(templateId?.notNull).toBe(true);
    expect(templateId?.hasDefault).toBe(false);
    expect(priceCheck).toBeDefined();
    expect(
      priceCheck && new PgDialect().sqlToQuery(priceCheck.value).sql,
    ).toContain('"discountedPrice" >= 0');
    expectUniqueColumns({
      columns: ['id', 'templateId'],
      table: templateRegistrationOptions,
    });
    expectOwnerForeignKey({
      columns: ['registrationOptionId', 'templateId'],
      foreignColumns: ['id', 'templateId'],
      foreignTable: templateRegistrationOptions,
      name: templateDiscountOptionOwnerForeignKeyName,
      table: templateRegistrationOptionDiscounts,
    });
    expectUniqueConstraint({
      columns: ['registrationOptionId', 'discountType'],
      name: templateDiscountOptionTypeUniqueConstraintName,
      table: templateRegistrationOptionDiscounts,
    });

    const insert = {
      discountedPrice: 500,
      discountType: 'esnCard',
      registrationOptionId: 'template-option-1',
      templateId: 'template-1',
    } satisfies typeof templateRegistrationOptionDiscounts.$inferInsert;
    expect(insert.templateId).toBe('template-1');
  });

  it('binds event discounts to one option owner and discount type', () => {
    const config = getTableConfig(eventRegistrationOptionDiscounts);
    const eventId = config.columns.find((column) => column.name === 'eventId');
    const priceCheck = config.checks.find(
      (constraint) =>
        constraint.name === eventDiscountPriceNonnegativeCheckName,
    );

    expect(eventRegistrationOptionDiscounts.id.primary).toBe(true);
    expect(eventId?.notNull).toBe(true);
    expect(eventId?.hasDefault).toBe(false);
    expect(priceCheck).toBeDefined();
    expect(
      priceCheck && new PgDialect().sqlToQuery(priceCheck.value).sql,
    ).toContain('"discountedPrice" >= 0');
    expectUniqueColumns({
      columns: ['id', 'eventId'],
      table: eventRegistrationOptions,
    });
    expectOwnerForeignKey({
      columns: ['registrationOptionId', 'eventId'],
      foreignColumns: ['id', 'eventId'],
      foreignTable: eventRegistrationOptions,
      name: eventDiscountOptionOwnerForeignKeyName,
      table: eventRegistrationOptionDiscounts,
    });
    expectUniqueConstraint({
      columns: ['registrationOptionId', 'discountType'],
      name: eventDiscountOptionTypeUniqueConstraintName,
      table: eventRegistrationOptionDiscounts,
    });

    const insert = {
      discountedPrice: 500,
      discountType: 'esnCard',
      eventId: 'event-1',
      registrationOptionId: 'event-option-1',
    } satisfies typeof eventRegistrationOptionDiscounts.$inferInsert;
    expect(insert.eventId).toBe('event-1');
  });
});
