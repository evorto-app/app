import { Schema, SchemaGetter } from 'effect';

export const notificationEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmailAddress = (value: string): string =>
  value.trim().toLowerCase();

export const isCanonicalEmailAddress = (value: string): boolean =>
  value.length <= 254 &&
  value === normalizeEmailAddress(value) &&
  notificationEmailPattern.test(value);

export const isValidEmailAddressInput = (value: string): boolean =>
  isCanonicalEmailAddress(normalizeEmailAddress(value));

export const CanonicalEmailAddress = Schema.String.check(
  Schema.makeFilter(isCanonicalEmailAddress, {
    expected: 'a lowercase, trimmed email address',
  }),
);

export const EmailAddressInput = Schema.String.pipe(
  Schema.decodeTo(CanonicalEmailAddress, {
    decode: SchemaGetter.transform(normalizeEmailAddress),
    encode: SchemaGetter.transform((value) => value),
  }),
);
