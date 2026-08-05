import { PermissionSchema } from '@shared/permissions/permissions';
import { Schema } from 'effect';

export const ROLE_NAME_MAX_LENGTH = 100;
export const ROLE_DESCRIPTION_MAX_LENGTH = 500;

export const RoleWriteInput = Schema.Struct({
  defaultOrganizerRole: Schema.Boolean,
  defaultUserRole: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  displayInHub: Schema.Boolean,
  name: Schema.String,
  permissions: Schema.mutable(Schema.Array(PermissionSchema)),
});

export type RoleWriteInput = Schema.Schema.Type<typeof RoleWriteInput>;

export class RoleNameAlreadyExistsError extends Schema.TaggedErrorClass<RoleNameAlreadyExistsError>()(
  'RoleNameAlreadyExistsError',
  {
    message: Schema.String,
    name: Schema.String,
  },
) {}

export class RoleWriteValidationError extends Schema.TaggedErrorClass<RoleWriteValidationError>()(
  'RoleWriteValidationError',
  {
    field: Schema.Literals(['description', 'name', 'permissions']),
    message: Schema.String,
  },
) {}
