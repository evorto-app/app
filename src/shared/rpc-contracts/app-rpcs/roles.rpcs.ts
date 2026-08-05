import { asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { ForbiddenOrUnauthorizedRpcError } from '../../errors/rpc-errors';

export const RoleLookupRecord = Schema.Struct({
  defaultOrganizerRole: Schema.Boolean,
  defaultUserRole: Schema.Boolean,
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});

export type RoleLookupRecord = Schema.Schema.Type<typeof RoleLookupRecord>;

export const RolesFindManyInput = Schema.Struct({});

export type RolesFindManyInput = Schema.Schema.Type<typeof RolesFindManyInput>;

export const RolesFindMany = asRpcQuery(
  Rpc.make('roles.findMany', {
    error: ForbiddenOrUnauthorizedRpcError,
    payload: RolesFindManyInput,
    success: Schema.Array(RoleLookupRecord),
  }),
);

export class RolesRpcs extends RpcGroup.make(RolesFindMany) {}
