import { literalUnion, optionalNullable } from '@shared/schema-utilities';
import {
  createDefaultTenantDiscountProviders,
  DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
  DEFAULT_TENANT_RECEIPT_COUNTRIES,
} from '@shared/tenant-config';
import { Effect, Schema, SchemaGetter } from 'effect';

import { GoogleLocation } from '../location';

export const supportedTenantCurrencies = ['EUR', 'CZK', 'AUD'] as const;
export const supportedTenantLocales = ['en-AU', 'en-GB', 'en-US'] as const;
export const supportedTenantTimezones = [
  'Europe/Prague',
  'Europe/Berlin',
  'Australia/Brisbane',
] as const;

const SupportedTenantCurrency = literalUnion(...supportedTenantCurrencies);
const SupportedTenantLocale = literalUnion(...supportedTenantLocales);
const SupportedTenantTimezone = literalUnion(...supportedTenantTimezones);

export type SupportedTenantCurrency =
  (typeof supportedTenantCurrencies)[number];
export type SupportedTenantLocale = (typeof supportedTenantLocales)[number];
export type SupportedTenantTimezone = (typeof supportedTenantTimezones)[number];

const normalizeTenantLocale = (value: string): SupportedTenantLocale => {
  if (value === 'en') {
    return 'en-GB';
  }

  const supportedLocale = supportedTenantLocales.find(
    (locale) => locale === value,
  );
  if (supportedLocale) {
    return supportedLocale;
  }

  throw new Error(`Unsupported tenant locale: ${value}`);
};

const normalizeTenantTimezone = (value: string): SupportedTenantTimezone => {
  if (value === 'Europe/Amsterdam') {
    return 'Europe/Berlin';
  }

  const supportedTimezone = supportedTenantTimezones.find(
    (timezone) => timezone === value,
  );
  if (supportedTimezone) {
    return supportedTimezone;
  }

  throw new Error(`Unsupported tenant timezone: ${value}`);
};

const TenantLocale = Schema.String.pipe(
  Schema.decodeTo(SupportedTenantLocale, {
    decode: SchemaGetter.transform(normalizeTenantLocale),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const TenantTimezone = Schema.String.pipe(
  Schema.decodeTo(SupportedTenantTimezone, {
    decode: SchemaGetter.transform(normalizeTenantTimezone),
    encode: SchemaGetter.transform((value) => value),
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
  canonicalRootUrl: Schema.NonEmptyString,
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
  seoDescription: optionalNullable(Schema.NonEmptyString),
  seoTitle: optionalNullable(Schema.NonEmptyString),
  stripeAccountId: optionalNullable(Schema.NonEmptyString),
  termsText: optionalNullable(Schema.NonEmptyString),
  termsUrl: optionalNullable(Schema.NonEmptyString),
  theme: literalUnion('evorto', 'esn'),
  timezone: TenantTimezone,
}) {}
