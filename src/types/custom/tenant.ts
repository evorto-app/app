import { literalUnion, optionalNullable } from '@shared/schema-utilities';
import {
  createDefaultTenantDiscountProviders,
  DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
  DEFAULT_TENANT_RECEIPT_COUNTRIES,
} from '@shared/tenant-config';
import { Effect, Schema, SchemaGetter } from 'effect';

import { GoogleLocation } from '../location';

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
  currency: literalUnion('EUR', 'CZK', 'AUD'),
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
  id: Schema.NonEmptyString,
  locale: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  receiptSettings: OptionalTenantReceiptSettings,
  seoDescription: optionalNullable(Schema.NonEmptyString),
  seoTitle: optionalNullable(Schema.NonEmptyString),
  stripeAccountId: optionalNullable(Schema.NonEmptyString),
  theme: literalUnion('evorto', 'esn'),
  timezone: Schema.NonEmptyString,
}) {}
