import { Schema } from 'effect';

export class Authentication extends Schema.Class<Authentication>(
  'Authentication',
)({
  isAuthenticated: Schema.Boolean,
}) {}
