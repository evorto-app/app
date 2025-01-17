import { Schema } from 'effect';

export class Tenant extends Schema.Class<Tenant>('Tenant')({
  currency: Schema.NonEmptyString,
  domain: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  locale: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  theme: Schema.Literal('evorto', 'esn'),
  timezone: Schema.NonEmptyString,
}) {}
