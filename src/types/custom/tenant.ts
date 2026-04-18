import {
  createDefaultTenantDiscountProviders,
  DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
  DEFAULT_TENANT_RECEIPT_COUNTRIES,
} from '@shared/tenant-config';
import { Schema } from 'effect';

export class Tenant extends Schema.Class<Tenant>('Tenant')({
  currency: Schema.Literal('EUR', 'CZK', 'AUD'),
  defaultLocation: Schema.optionalWith(Schema.Any, {
    nullable: true,
  }),
  discountProviders: Schema.optionalWith(
    Schema.Struct({
      esnCard: Schema.optionalWith(
        Schema.Struct({
          config: Schema.Struct({
            buyEsnCardUrl: Schema.optional(Schema.NonEmptyString),
          }),
          status: Schema.Literal('disabled', 'enabled'),
        }),
        {
          default: () => createDefaultTenantDiscountProviders().esnCard,
        },
      ),
    }),
    {
      default: () => createDefaultTenantDiscountProviders(),
      nullable: true,
    },
  ),
  domain: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  locale: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  receiptSettings: Schema.optionalWith(
    Schema.Struct({
      allowOther: Schema.optionalWith(Schema.Boolean, {
        default: () => DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
      }),
      receiptCountries: Schema.optionalWith(
        Schema.Array(Schema.NonEmptyString),
        {
          default: () => [...DEFAULT_TENANT_RECEIPT_COUNTRIES],
        },
      ),
    }),
    {
      default: () => ({
        allowOther: DEFAULT_TENANT_RECEIPT_ALLOW_OTHER,
        receiptCountries: [...DEFAULT_TENANT_RECEIPT_COUNTRIES],
      }),
      nullable: true,
    },
  ),
  stripeAccountId: Schema.optionalWith(Schema.NonEmptyString, {
    nullable: true,
  }),
  theme: Schema.Literal('evorto', 'esn'),
  timezone: Schema.NonEmptyString,
}) {}
