import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { nonNegativeNumber } from '@shared/schema-utilities';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { TenantRolePermissionSchema } from '../../permissions/permissions';
import {
  PlatformOperationRpcError,
  PlatformTenantMutationContext,
  PlatformTenantTarget,
} from './platform-operations.shared';

const PlatformTenantUserPageLimit = nonNegativeNumber.check(
  Schema.isInt(),
  Schema.isLessThanOrEqualTo(100),
);

const PlatformTenantUserPageOffset = nonNegativeNumber.check(Schema.isInt());

const PlatformTaxRateIds = Schema.Array(Schema.NonEmptyString).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
);

const PlatformRoleIds = Schema.Array(Schema.NonEmptyString).check(
  Schema.isMaxLength(100),
);

export class PlatformRoleRecord extends Schema.Class<PlatformRoleRecord>(
  'PlatformRoleRecord',
)({
  collapseMembersInHup: Schema.Boolean,
  defaultOrganizerRole: Schema.Boolean,
  defaultUserRole: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  displayInHub: Schema.Boolean,
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  permissions: Schema.mutable(Schema.Array(TenantRolePermissionSchema)),
  sortOrder: Schema.Number,
}) {}

export class PlatformTenantUserRecord extends Schema.Class<PlatformTenantUserRecord>(
  'PlatformTenantUserRecord',
)({
  email: Schema.String,
  firstName: Schema.String,
  id: Schema.NonEmptyString,
  lastName: Schema.String,
  roleIds: Schema.Array(Schema.NonEmptyString),
  roles: Schema.Array(Schema.String),
}) {}

export class PlatformTenantUsersListResult extends Schema.Class<PlatformTenantUsersListResult>(
  'PlatformTenantUsersListResult',
)({
  users: Schema.Array(PlatformTenantUserRecord),
  usersCount: nonNegativeNumber,
}) {}

const PlatformRoleWriteFields = {
  collapseMembersInHup: Schema.Boolean,
  defaultOrganizerRole: Schema.Boolean,
  defaultUserRole: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  displayInHub: Schema.Boolean,
  name: Schema.NonEmptyString,
  permissions: Schema.mutable(Schema.Array(TenantRolePermissionSchema)),
};

export const PlatformRoleWriteInput = Schema.Struct(PlatformRoleWriteFields);

export type PlatformRoleWriteInput = Schema.Schema.Type<
  typeof PlatformRoleWriteInput
>;

export class PlatformStripeTaxRateRecord extends Schema.Class<PlatformStripeTaxRateRecord>(
  'PlatformStripeTaxRateRecord',
)({
  active: Schema.Boolean,
  country: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  imported: Schema.Boolean,
  inclusive: Schema.Boolean,
  percentage: Schema.NullOr(Schema.Number),
  state: Schema.NullOr(Schema.String),
}) {}

export const PlatformTenantUsersListInput = Schema.Struct({
  ...PlatformTenantTarget.fields,
  limit: Schema.optional(PlatformTenantUserPageLimit),
  offset: Schema.optional(PlatformTenantUserPageOffset),
  search: Schema.optional(Schema.NonEmptyString),
});

export type PlatformTenantUsersListInput = Schema.Schema.Type<
  typeof PlatformTenantUsersListInput
>;

export const PlatformTenantUsersAssignRolesInput = Schema.Struct({
  ...PlatformTenantMutationContext.fields,
  roleIds: PlatformRoleIds,
  userId: Schema.NonEmptyString,
});

export type PlatformTenantUsersAssignRolesInput = Schema.Schema.Type<
  typeof PlatformTenantUsersAssignRolesInput
>;

export const PlatformRoleTargetInput = Schema.Struct({
  ...PlatformTenantTarget.fields,
  roleId: Schema.NonEmptyString,
});

export type PlatformRoleTargetInput = Schema.Schema.Type<
  typeof PlatformRoleTargetInput
>;

export const PlatformRoleCreateInput = Schema.Struct({
  ...PlatformTenantMutationContext.fields,
  ...PlatformRoleWriteInput.fields,
});

export type PlatformRoleCreateInput = Schema.Schema.Type<
  typeof PlatformRoleCreateInput
>;

export const PlatformRoleUpdateInput = Schema.Struct({
  ...PlatformRoleCreateInput.fields,
  roleId: Schema.NonEmptyString,
});

export type PlatformRoleUpdateInput = Schema.Schema.Type<
  typeof PlatformRoleUpdateInput
>;

export const PlatformRoleDeleteInput = Schema.Struct({
  ...PlatformTenantMutationContext.fields,
  roleId: Schema.NonEmptyString,
});

export type PlatformRoleDeleteInput = Schema.Schema.Type<
  typeof PlatformRoleDeleteInput
>;

export const PlatformTaxRatesImportInput = Schema.Struct({
  ...PlatformTenantMutationContext.fields,
  ids: PlatformTaxRateIds,
});

export type PlatformTaxRatesImportInput = Schema.Schema.Type<
  typeof PlatformTaxRatesImportInput
>;

export const PlatformTenantUsersList = asRpcQuery(
  Rpc.make('platform.tenantUsers.list', {
    error: PlatformOperationRpcError,
    payload: PlatformTenantUsersListInput,
    success: PlatformTenantUsersListResult,
  }),
);

export const PlatformTenantUsersAssignRoles = asRpcMutation(
  Rpc.make('platform.tenantUsers.assignRoles', {
    error: PlatformOperationRpcError,
    payload: PlatformTenantUsersAssignRolesInput,
    success: Schema.Void,
  }),
);

export const PlatformRolesList = asRpcQuery(
  Rpc.make('platform.roles.list', {
    error: PlatformOperationRpcError,
    payload: PlatformTenantTarget,
    success: Schema.Array(PlatformRoleRecord),
  }),
);

export const PlatformRolesFindOne = asRpcQuery(
  Rpc.make('platform.roles.findOne', {
    error: PlatformOperationRpcError,
    payload: PlatformRoleTargetInput,
    success: PlatformRoleRecord,
  }),
);

export const PlatformRolesCreate = asRpcMutation(
  Rpc.make('platform.roles.create', {
    error: PlatformOperationRpcError,
    payload: PlatformRoleCreateInput,
    success: PlatformRoleRecord,
  }),
);

export const PlatformRolesUpdate = asRpcMutation(
  Rpc.make('platform.roles.update', {
    error: PlatformOperationRpcError,
    payload: PlatformRoleUpdateInput,
    success: PlatformRoleRecord,
  }),
);

export const PlatformRolesDelete = asRpcMutation(
  Rpc.make('platform.roles.delete', {
    error: PlatformOperationRpcError,
    payload: PlatformRoleDeleteInput,
    success: Schema.Void,
  }),
);

export const PlatformTaxRatesListStripe = asRpcQuery(
  Rpc.make('platform.taxRates.listStripe', {
    error: PlatformOperationRpcError,
    payload: PlatformTenantTarget,
    success: Schema.Array(PlatformStripeTaxRateRecord),
  }),
);

export const PlatformTaxRatesImport = asRpcMutation(
  Rpc.make('platform.taxRates.import', {
    error: PlatformOperationRpcError,
    payload: PlatformTaxRatesImportInput,
    success: Schema.Void,
  }),
);

export class PlatformTenantAdminRpcs extends RpcGroup.make(
  PlatformRolesCreate,
  PlatformRolesDelete,
  PlatformRolesFindOne,
  PlatformRolesList,
  PlatformRolesUpdate,
  PlatformTaxRatesImport,
  PlatformTaxRatesListStripe,
  PlatformTenantUsersAssignRoles,
  PlatformTenantUsersList,
) {}
