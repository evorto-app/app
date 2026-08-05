import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  CanonicalIban,
  IbanInput,
  isCanonicalIban,
  normalizeIban,
} from './iban';
import {
  CanonicalEmailAddress,
  EmailAddressInput,
  isCanonicalEmailAddress,
  normalizeEmailAddress,
} from './notification-email';

describe('profile email fields', () => {
  it('normalizes profile email input once and accepts the canonical value', () => {
    expect(normalizeEmailAddress(' Finance+Receipts@Example.COM ')).toBe(
      'finance+receipts@example.com',
    );
    expect(
      Schema.decodeUnknownSync(EmailAddressInput)(
        ' Finance+Receipts@Example.COM ',
      ),
    ).toBe('finance+receipts@example.com');
    expect(isCanonicalEmailAddress('finance+receipts@example.com')).toBe(true);
  });

  it('rejects malformed and non-canonical stored email values', () => {
    expect(() =>
      Schema.decodeUnknownSync(EmailAddressInput)('finance'),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CanonicalEmailAddress)(' Finance@Example.COM '),
    ).toThrow();
    expect(() => Schema.decodeUnknownSync(CanonicalEmailAddress)('')).toThrow();
  });
});

describe('profile IBAN fields', () => {
  it('removes whitespace, uppercases input, and validates MOD-97', () => {
    expect(normalizeIban(' nl91 abna 0417 1643 00 ')).toBe(
      'NL91ABNA0417164300',
    );
    expect(
      Schema.decodeUnknownSync(IbanInput)(' nl91 abna 0417 1643 00 '),
    ).toBe('NL91ABNA0417164300');
    expect(isCanonicalIban('DE89370400440532013000')).toBe(true);
    expect(isCanonicalIban('RU0304452522540817810538091310419')).toBe(true);
  });

  it('rejects unknown countries, wrong lengths, and wrong checksums', () => {
    expect(isCanonicalIban('ZZ89370400440532013000')).toBe(false);
    expect(isCanonicalIban('DE8937040044053201300')).toBe(false);
    expect(isCanonicalIban('DE88370400440532013000')).toBe(false);
    expect(() =>
      Schema.decodeUnknownSync(CanonicalIban)('nl91 abna 0417 1643 00'),
    ).toThrow();
  });
});
