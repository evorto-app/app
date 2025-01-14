import { Schema } from 'effect';

import { PermissionSchema } from '../../shared/permissions/permissions';

export class User extends Schema.Class<User>('User')({
  auth0Id: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  permissions: Schema.Array(PermissionSchema),
}) {}
