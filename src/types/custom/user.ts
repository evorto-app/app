import { Schema } from 'effect';

import { PermissionSchema } from '../../server/schemas/permission.schema';

export class User extends Schema.Class<User>('User')({
  attributes: Schema.Array(Schema.Literal('events:organizesSome')),
  auth0Id: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  firstName: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  lastName: Schema.NonEmptyString,
  permissions: Schema.Array(PermissionSchema),
  roleIds: Schema.Array(Schema.NonEmptyString),
}) {}
