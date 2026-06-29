import { Schema } from 'effect';

import { PermissionSchema } from '../../shared/permissions/permissions';
import { Authentication } from './authentication';
import { Tenant } from './tenant';
import { User } from './user';

export class Context extends Schema.Class<Context>('Context')({
  authentication: Authentication,
  permissions: Schema.Array(PermissionSchema),
  tenant: Tenant,
  user: Schema.optional(User),
}) {}
