import { Schema } from 'effect';

import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '../../errors/rpc-errors';

export class TemplateCategoryNotFoundError extends Schema.TaggedError<TemplateCategoryNotFoundError>()(
  'TemplateCategoryNotFoundError',
  {
    id: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

export const TemplateCategoryRpcError = Schema.Union(
  TemplateCategoryNotFoundError,
  RpcForbiddenError,
  RpcUnauthorizedError,
);
export type TemplateCategoryRpcError = Schema.Schema.Type<
  typeof TemplateCategoryRpcError
>;
