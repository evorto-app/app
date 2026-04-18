import { Schema } from 'effect';

import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
  UnauthorizedRpcError,
} from '../../errors/rpc-errors';

export class DiscountCardConflictError extends Schema.TaggedError<DiscountCardConflictError>()(
  'DiscountCardConflictError',
  {
    message: Schema.String,
  },
) {}

export class DiscountCardNotFoundError extends Schema.TaggedError<DiscountCardNotFoundError>()(
  'DiscountCardNotFoundError',
  {
    message: Schema.String,
  },
) {}

export const DiscountsRpcError = UnauthorizedRpcError;
export type DiscountsRpcError = UnauthorizedRpcError;

export const DiscountsCardMutationError = Schema.Union(
  RpcBadRequestError,
  DiscountCardConflictError,
  RpcForbiddenError,
  RpcInternalServerError,
  DiscountCardNotFoundError,
  RpcUnauthorizedError,
);
export type DiscountsCardMutationError = Schema.Schema.Type<
  typeof DiscountsCardMutationError
>;
