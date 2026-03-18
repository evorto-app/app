import { Schema } from 'effect';

import {
  RpcBadRequestError,
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

export class AdminTenantNotFoundError extends Schema.TaggedError<AdminTenantNotFoundError>()(
  'AdminTenantNotFoundError',
  {
    id: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

export const AdminTenantRpcError = Schema.Union(
  RpcBadRequestError,
  RpcForbiddenError,
  AdminTenantNotFoundError,
  RpcUnauthorizedError,
);
export type AdminTenantRpcError = Schema.Schema.Type<typeof AdminTenantRpcError>;
