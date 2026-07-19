import {
  literalUnion,
  nonNegativeNumber,
  optionalNullable,
} from '@shared/schema-utilities';
import {
  createDefaultTenantDiscountProviders,
  DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
  DEFAULT_TENANT_RECEIPT_COUNTRIES,
} from '@shared/tenant-config';
import { Effect, Schema, SchemaGetter } from 'effect';

import { GoogleLocation } from '../location';

export const supportedTenantCurrencies = ['EUR', 'CZK', 'AUD'] as const;
export const TENANT_FORMATTING_LOCALE = 'de-DE' as const;
export const DEFAULT_TENANT_TIMEZONE = 'Europe/Berlin' as const;
export const supportedTenantLocales = [TENANT_FORMATTING_LOCALE] as const;
const legacyTenantLocales: ReadonlySet<string> = new Set([
  'en-AU',
  'en-GB',
  'en-US',
]);
export const supportedTenantTimezones = [
  'Europe/Prague',
  DEFAULT_TENANT_TIMEZONE,
  'Australia/Brisbane',
] as const;

const SupportedTenantCurrency = literalUnion(...supportedTenantCurrencies);
const SupportedTenantLocale = literalUnion(...supportedTenantLocales);

export const isIanaTimezone = (value: string): boolean => {
  if (
    value.length === 0 ||
    value.length > 64 ||
    value.trim() !== value ||
    (value !== 'UTC' && !value.includes('/'))
  ) {
    return false;
  }

  try {
    new Intl.DateTimeFormat(TENANT_FORMATTING_LOCALE, {
      timeZone: value,
    }).format(0);
    return true;
  } catch {
    return false;
  }
};

export const TenantTimezone = Schema.String.check(
  Schema.makeFilter(isIanaTimezone, {
    expected: 'an IANA timezone name such as Europe/Berlin',
  }),
);

export type SupportedTenantCurrency =
  (typeof supportedTenantCurrencies)[number];
export type SupportedTenantLocale = (typeof supportedTenantLocales)[number];
export type SupportedTenantTimezone = Schema.Schema.Type<typeof TenantTimezone>;

const normalizeTenantLocale = (value: string): SupportedTenantLocale => {
  if (
    value === 'en' ||
    value === TENANT_FORMATTING_LOCALE ||
    legacyTenantLocales.has(value)
  ) {
    return TENANT_FORMATTING_LOCALE;
  }

  throw new Error(`Unsupported tenant locale: ${value}`);
};

const TenantLocale = Schema.String.pipe(
  Schema.decodeTo(SupportedTenantLocale, {
    decode: SchemaGetter.transform(normalizeTenantLocale),
    encode: SchemaGetter.transform(() => TENANT_FORMATTING_LOCALE),
  }),
);

const OptionalGoogleLocation = Schema.NullishOr(GoogleLocation).pipe(
  Schema.decodeTo(Schema.UndefinedOr(GoogleLocation), {
    decode: SchemaGetter.transform((value) => value ?? undefined),
    encode: SchemaGetter.transform((value) => value ?? null),
  }),
  Schema.withDecodingDefaultTypeKey(
    Effect.sync(function missingDefaultLocation(): undefined {
      return;
    }),
  ),
);

const TenantReceiptSettings = Schema.Struct({
  allowOther: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefaultType(
      Effect.sync(() => DEFAULT_TENANT_RECEIPT_ALLOW_OTHER),
    ),
  ),
  receiptCountries: Schema.optional(Schema.Array(Schema.NonEmptyString)).pipe(
    Schema.withDecodingDefaultType(
      Effect.sync(() => [...DEFAULT_TENANT_RECEIPT_COUNTRIES]),
    ),
  ),
});

const OptionalTenantReceiptSettings = Schema.NullishOr(
  TenantReceiptSettings,
).pipe(
  Schema.decodeTo(Schema.UndefinedOr(TenantReceiptSettings), {
    decode: SchemaGetter.transform((value) => value ?? undefined),
    encode: SchemaGetter.transform((value) => value ?? null),
  }),
  Schema.withDecodingDefaultType(
    Effect.sync(() => ({
      allowOther: DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
      receiptCountries: [...DEFAULT_TENANT_RECEIPT_COUNTRIES],
    })),
  ),
);

export class Tenant extends Schema.Class<Tenant>('Tenant')({
  cancellationDeadlineHoursBeforeStart: nonNegativeNumber.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.sync(() => 120)),
  ),
  currency: SupportedTenantCurrency,
  defaultLocation: OptionalGoogleLocation,
  discountProviders: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        esnCard: Schema.optional(
          Schema.Struct({
            config: Schema.Struct({
              buyEsnCardUrl: Schema.optional(Schema.NonEmptyString),
            }),
            status: literalUnion('disabled', 'enabled'),
          }).pipe(
            Schema.withDecodingDefaultType(
              Effect.sync(() => createDefaultTenantDiscountProviders().esnCard),
            ),
          ),
        ),
      }),
    ),
  ).pipe(
    Schema.withDecodingDefaultType(
      Effect.sync(() => createDefaultTenantDiscountProviders()),
    ),
  ),
  domain: Schema.NonEmptyString,
  emailSenderEmail: optionalNullable(Schema.NonEmptyString),
  emailSenderName: optionalNullable(Schema.NonEmptyString),
  faviconUrl: optionalNullable(Schema.NonEmptyString),
  id: Schema.NonEmptyString,
  legalNoticeText: optionalNullable(Schema.NonEmptyString),
  legalNoticeUrl: optionalNullable(Schema.NonEmptyString),
  locale: TenantLocale,
  logoUrl: optionalNullable(Schema.NonEmptyString),
  maxActiveRegistrationsPerUser: Schema.optional(Schema.Number).pipe(
    Schema.withDecodingDefaultType(Effect.sync(() => 0)),
  ),
  name: Schema.NonEmptyString,
  privacyPolicyText: optionalNullable(Schema.NonEmptyString),
  privacyPolicyUrl: optionalNullable(Schema.NonEmptyString),
  receiptSettings: OptionalTenantReceiptSettings,
  refundFeesOnCancellation: Schema.Boolean.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.sync(() => true)),
  ),
  seoDescription: optionalNullable(Schema.NonEmptyString),
  seoTitle: optionalNullable(Schema.NonEmptyString),
  stripeAccountId: optionalNullable(Schema.NonEmptyString),
  termsText: optionalNullable(Schema.NonEmptyString),
  termsUrl: optionalNullable(Schema.NonEmptyString),
  theme: literalUnion('evorto', 'esn'),
  timezone: TenantTimezone,
  transferDeadlineHoursBeforeStart: nonNegativeNumber.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.sync(() => 0)),
  ),
}) {}
