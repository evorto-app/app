import { Schema } from 'effect';

export class Tenant extends Schema.Class<Tenant>('Tenant')({
  currency: Schema.Literal('EUR', 'CZK', 'AUD'),
  defaultLocation: Schema.optionalWith(Schema.Any, {
    nullable: true,
  }),
  // Expose tenant-wide discount provider configuration to clients
  // Shape example: { esnCard?: { enabled: boolean; config?: { ctaEnabled?: boolean; ctaLink?: string } } }
  discountProviders: Schema.optionalWith(Schema.Any, {
    nullable: true,
  }),
  domain: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  locale: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  stripeAccountId: Schema.optionalWith(Schema.NonEmptyString, {
    nullable: true,
  }),
  theme: Schema.Literal('evorto', 'esn'),
  timezone: Schema.NonEmptyString,
}) {}
