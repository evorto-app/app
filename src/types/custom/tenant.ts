import { Schema } from 'effect';

export class Tenant extends Schema.Class<Tenant>('Tenant')({
  domain: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
}) {}
