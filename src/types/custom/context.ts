import { Schema } from 'effect';

import { Authentication } from './authentication';
import { Tenant } from './tenant';
import { User } from './user';

export class Context extends Schema.Class<Context>('Context')({
  authentication: Authentication,
  tenant: Tenant,
  user: Schema.optional(User),
}) {}
