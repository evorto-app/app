import {
  maximumPostgresInteger,
  nonNegativePostgresInteger,
} from '@shared/schema-utilities';
import { Schema } from 'effect';

export const maximumFinanceReceiptMinorUnits = maximumPostgresInteger;

export const FinanceReceiptMinorUnitAmount = nonNegativePostgresInteger;

export const FinanceReceiptPositiveMinorUnitAmount =
  FinanceReceiptMinorUnitAmount.check(Schema.isGreaterThan(0));

const calendarDatePattern = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

export const isFinanceReceiptCalendarDate = (value: string): boolean => {
  const match = calendarDatePattern.exec(value);
  if (!match?.groups) {
    return false;
  }

  const year = Number(match.groups['year']);
  const month = Number(match.groups['month']);
  const day = Number(match.groups['day']);
  if (year === 0 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];

  return daysInMonth !== undefined && day <= daysInMonth;
};

export const FinanceReceiptCalendarDate = Schema.String.check(
  Schema.makeFilter(isFinanceReceiptCalendarDate, {
    message: 'Expected a calendar date in YYYY-MM-DD format',
  }),
);

export type FinanceReceiptAmountError =
  | 'alcoholAmountOutOfRange'
  | 'alcoholFlagContradiction'
  | 'depositAmountOutOfRange'
  | 'depositAndAlcoholExceedTotal'
  | 'depositFlagContradiction'
  | 'taxAmountExceedsTotal'
  | 'taxAmountOutOfRange'
  | 'totalAmountOutOfRange';

export interface FinanceReceiptAmounts {
  readonly alcoholAmount: number;
  readonly depositAmount: number;
  readonly hasAlcohol: boolean;
  readonly hasDeposit: boolean;
  readonly taxAmount: number;
  readonly totalAmount: number;
}

const isNonNegativeMinorUnitAmount = (value: number): boolean =>
  Number.isInteger(value) &&
  value >= 0 &&
  value <= maximumFinanceReceiptMinorUnits;

export const validateFinanceReceiptAmounts = (
  amounts: FinanceReceiptAmounts,
): FinanceReceiptAmountError | null => {
  if (
    !Number.isInteger(amounts.totalAmount) ||
    amounts.totalAmount <= 0 ||
    amounts.totalAmount > maximumFinanceReceiptMinorUnits
  ) {
    return 'totalAmountOutOfRange';
  }
  if (!isNonNegativeMinorUnitAmount(amounts.taxAmount)) {
    return 'taxAmountOutOfRange';
  }
  if (!isNonNegativeMinorUnitAmount(amounts.depositAmount)) {
    return 'depositAmountOutOfRange';
  }
  if (!isNonNegativeMinorUnitAmount(amounts.alcoholAmount)) {
    return 'alcoholAmountOutOfRange';
  }
  const hasPositiveDepositAmount = amounts.depositAmount > 0;
  if (amounts.hasDeposit !== hasPositiveDepositAmount) {
    return 'depositFlagContradiction';
  }
  const hasPositiveAlcoholAmount = amounts.alcoholAmount > 0;
  if (amounts.hasAlcohol !== hasPositiveAlcoholAmount) {
    return 'alcoholFlagContradiction';
  }
  if (amounts.taxAmount > amounts.totalAmount) {
    return 'taxAmountExceedsTotal';
  }
  if (amounts.depositAmount + amounts.alcoholAmount > amounts.totalAmount) {
    return 'depositAndAlcoholExceedTotal';
  }

  return null;
};
