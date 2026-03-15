import { Schema } from 'effect';

import {
  BadRequestForbiddenOrUnauthorizedRpcError,
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '../../errors/rpc-errors';

export class AdminRoleNotFoundError extends Schema.TaggedError<AdminRoleNotFoundError>()(
  'AdminRoleNotFoundError',
  {
    id: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

export const AdminRoleRpcError = Schema.Union(
  RpcForbiddenError,
  AdminRoleNotFoundError,
  RpcUnauthorizedError,
);
export type AdminRoleRpcError = Schema.Schema.Type<typeof AdminRoleRpcError>;

export const AdminTenantRpcError = BadRequestForbiddenOrUnauthorizedRpcError;
export type AdminTenantRpcError = BadRequestForbiddenOrUnauthorizedRpcError;
