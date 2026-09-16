import { Schema } from 'effect';

import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '../../errors/rpc-errors';

export class RoleLookupNotFoundError extends Schema.TaggedErrorClass<RoleLookupNotFoundError>()(
  'RoleLookupNotFoundError',
  {
    id: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

export const RoleLookupRpcError = Schema.Union([
  RoleLookupNotFoundError,
  RpcForbiddenError,
  RpcUnauthorizedError,
]);
export type RoleLookupRpcError = Schema.Schema.Type<typeof RoleLookupRpcError>;
