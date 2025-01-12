import { Schema } from 'effect';

export const roleSchema = Schema.Struct({
  defaultOrganizerRole: Schema.Boolean,
  defaultUserRole: Schema.Boolean,
  description: Schema.NullOr(Schema.NonEmptyString),
  name: Schema.NonEmptyString,
  permissionAdminAnalytics: Schema.Boolean,
  permissionAdminBilling: Schema.Boolean,
  permissionAdminRoles: Schema.Boolean,
  permissionAdminSettings: Schema.Boolean,
  permissionEventCreate: Schema.Boolean,
  permissionEventDelete: Schema.Boolean,
  permissionEventEdit: Schema.Boolean,
  permissionEventRegistrationManage: Schema.Boolean,
  permissionEventView: Schema.Boolean,
  permissionTemplateCreate: Schema.Boolean,
  permissionTemplateDelete: Schema.Boolean,
  permissionTemplateEdit: Schema.Boolean,
  permissionTemplateView: Schema.Boolean,
  permissionUserCreate: Schema.Boolean,
  permissionUserDelete: Schema.Boolean,
  permissionUserEdit: Schema.Boolean,
  permissionUserView: Schema.Boolean,
});

export type Role = Schema.Schema.Type<typeof roleSchema>;

export const roleUpdateSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  role: roleSchema,
});

export type RoleUpdate = Schema.Schema.Type<typeof roleUpdateSchema>;
