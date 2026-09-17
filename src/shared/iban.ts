import { Schema, SchemaGetter } from 'effect';

// SWIFT IBAN Registry, Release 102 (June 2026).
const ibanLengths: Readonly<Record<string, number>> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BI: 27,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DJ: 27,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FK: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HN: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MN: 20,
  MR: 27,
  MT: 31,
  MU: 30,
  NI: 28,
  NL: 18,
  NO: 15,
  OM: 23,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  RU: 33,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  SO: 23,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
  YE: 30,
};

const ibanPattern = /^[A-Z]{2}\d{2}[A-Z\d]+$/;

export const normalizeIban = (value: string): string =>
  value.replaceAll(/\s+/gu, '').toUpperCase();

const ibanMod97 = (value: string): number => {
  let remainder = 0;
  const rearranged = `${value.slice(4)}${value.slice(0, 4)}`;

  for (const character of rearranged) {
    const code = character.codePointAt(0);
    if (code === undefined) {
      throw new Error('IBAN MOD-97 received an empty character');
    }
    if (code >= 48 && code <= 57) {
      remainder = (remainder * 10 + code - 48) % 97;
      continue;
    }
    remainder = (remainder * 100 + code - 55) % 97;
  }

  return remainder;
};

export const isCanonicalIban = (value: string): boolean =>
  value === normalizeIban(value) &&
  ibanPattern.test(value) &&
  ibanLengths[value.slice(0, 2)] === value.length &&
  ibanMod97(value) === 1;

export const isValidIbanInput = (value: string): boolean =>
  isCanonicalIban(normalizeIban(value));

export const CanonicalIban = Schema.String.check(
  Schema.makeFilter(isCanonicalIban, {
    expected: 'a canonical, checksum-valid IBAN',
  }),
);

export const IbanInput = Schema.String.pipe(
  Schema.decodeTo(CanonicalIban, {
    decode: SchemaGetter.transform(normalizeIban),
    encode: SchemaGetter.transform((value) => value),
  }),
);
