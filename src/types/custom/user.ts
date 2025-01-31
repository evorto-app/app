import { Schema } from 'effect';

import { PermissionSchema } from '../../shared/permissions/permissions';

export class User extends Schema.Class<User>('User')({
  auth0Id: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  firstName: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  lastName: Schema.NonEmptyString,
  permissions: Schema.Array(PermissionSchema),
  roleIds: Schema.Array(Schema.NonEmptyString),
}) {}
