import { Schema } from 'effect';

import { PermissionSchema } from '../../shared/permissions/permissions';
import { Authentication } from './authentication';
import { PlatformAdministratorAuthority } from './platform-authority';
import { Tenant } from './tenant';
import { User } from './user';

export class Context extends Schema.Class<Context>('Context')({
  authentication: Authentication,
  permissions: Schema.Array(PermissionSchema),
  platformAuthority: Schema.optional(PlatformAdministratorAuthority),
  tenant: Tenant,
  user: Schema.optional(User),
}) {}
