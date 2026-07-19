import {
  BadRequestForbiddenInternalUnauthorizedRpcError,
  RpcBadRequestError,
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import { Schema } from 'effect';

export class AdminRoleNotFoundError extends Schema.TaggedErrorClass<AdminRoleNotFoundError>()(
  'AdminRoleNotFoundError',
  {
    id: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

export const AdminRoleRpcError = Schema.Union([
  RpcBadRequestError,
  RpcForbiddenError,
  AdminRoleNotFoundError,
  RpcUnauthorizedError,
]);
export type AdminRoleRpcError = Schema.Schema.Type<typeof AdminRoleRpcError>;

export class AdminTenantNotFoundError extends Schema.TaggedErrorClass<AdminTenantNotFoundError>()(
  'AdminTenantNotFoundError',
  {
    id: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

export const AdminTenantRpcError = Schema.Union([
  BadRequestForbiddenInternalUnauthorizedRpcError,
  AdminTenantNotFoundError,
]);
export type AdminTenantRpcError = Schema.Schema.Type<
  typeof AdminTenantRpcError
>;
