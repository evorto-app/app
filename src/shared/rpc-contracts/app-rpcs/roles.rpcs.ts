import { asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { RoleLookupRpcError } from './roles.errors';

export const RoleLookupRecord = Schema.Struct({
  defaultOrganizerRole: Schema.Boolean,
  defaultUserRole: Schema.Boolean,
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});

export type RoleLookupRecord = Schema.Schema.Type<typeof RoleLookupRecord>;

export const RolesFindManyInput = Schema.Struct({
  defaultOrganizerRole: Schema.optional(Schema.Boolean),
  defaultUserRole: Schema.optional(Schema.Boolean),
  search: Schema.optional(Schema.String),
});

export type RolesFindManyInput = Schema.Schema.Type<typeof RolesFindManyInput>;

export const RolesFindMany = asRpcQuery(
  Rpc.make('roles.findMany', {
    error: RoleLookupRpcError,
    payload: RolesFindManyInput,
    success: Schema.Array(RoleLookupRecord),
  }),
);

export const RolesFindOne = asRpcQuery(
  Rpc.make('roles.findOne', {
    error: RoleLookupRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: RoleLookupRecord,
  }),
);

export class RolesRpcs extends RpcGroup.make(RolesFindMany, RolesFindOne) {}
