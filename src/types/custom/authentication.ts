import { Schema } from 'effect';

export class Authentication extends Schema.Class<Authentication>(
  'Authentication',
)({
  cookie: Schema.optional(Schema.NonEmptyString),
  isAuthenticated: Schema.Boolean,
}) {}
