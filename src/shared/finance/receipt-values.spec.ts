import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  FinanceReceiptCalendarDate,
  isFinanceReceiptCalendarDate,
  maximumFinanceReceiptMinorUnits,
  validateFinanceReceiptAmounts,
} from './receipt-values';

describe('finance receipt values', () => {
  it.each(['2024-02-29', '2026-01-01', '9999-12-31'])(
    'accepts the calendar date %s without creating a timestamp',
    (value) => {
      expect(isFinanceReceiptCalendarDate(value)).toBe(true);
      expect(Schema.decodeUnknownSync(FinanceReceiptCalendarDate)(value)).toBe(
        value,
      );
    },
  );

  it.each([
    '0000-01-01',
    '2023-02-29',
    '2026-02-30',
    '2026-2-03',
    '2026-03-3',
    '2026-03-03T00:00:00.000Z',
  ])('rejects the non-calendar-date value %s', (value) => {
    expect(isFinanceReceiptCalendarDate(value)).toBe(false);
    expect(() =>
      Schema.decodeUnknownSync(FinanceReceiptCalendarDate)(value),
    ).toThrow();
  });

  it('accepts a positive total with explicit zero optional amounts', () => {
    expect(
      validateFinanceReceiptAmounts({
        alcoholAmount: 0,
        depositAmount: 0,
        hasAlcohol: false,
        hasDeposit: false,
        taxAmount: 0,
        totalAmount: maximumFinanceReceiptMinorUnits,
      }),
    ).toBeNull();
  });

  it.each([
    ['zero total', { totalAmount: 0 }, 'totalAmountOutOfRange'],
    ['fractional total', { totalAmount: 100.5 }, 'totalAmountOutOfRange'],
    [
      'amount beyond PostgreSQL integer',
      { totalAmount: maximumFinanceReceiptMinorUnits + 1 },
      'totalAmountOutOfRange',
    ],
    [
      'hidden deposit',
      { depositAmount: 10, hasDeposit: false },
      'depositFlagContradiction',
    ],
    [
      'missing deposit',
      { depositAmount: 0, hasDeposit: true },
      'depositFlagContradiction',
    ],
    [
      'hidden alcohol',
      { alcoholAmount: 10, hasAlcohol: false },
      'alcoholFlagContradiction',
    ],
    ['tax above total', { taxAmount: 101 }, 'taxAmountExceedsTotal'],
    [
      'components above total',
      {
        alcoholAmount: 60,
        depositAmount: 50,
        hasAlcohol: true,
        hasDeposit: true,
      },
      'depositAndAlcoholExceedTotal',
    ],
  ] as const)('rejects %s', (_label, override, expected) => {
    expect(
      validateFinanceReceiptAmounts({
        alcoholAmount: 0,
        depositAmount: 0,
        hasAlcohol: false,
        hasDeposit: false,
        taxAmount: 0,
        totalAmount: 100,
        ...override,
      }),
    ).toBe(expected);
  });
});
