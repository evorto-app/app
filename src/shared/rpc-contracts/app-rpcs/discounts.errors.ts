import { Schema } from 'effect';

import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '../../errors/rpc-errors';

export class DiscountCardChangedError extends Schema.TaggedError<DiscountCardChangedError>()(
  'DiscountCardChangedError',
  {
    message: Schema.String,
  },
) {}

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

export const DiscountsRpcError = RpcUnauthorizedError;
export type DiscountsRpcError = RpcUnauthorizedError;

export const DiscountsCardMutationError = Schema.Union([
  RpcBadRequestError,
  DiscountCardChangedError,
  DiscountCardConflictError,
  RpcForbiddenError,
  RpcInternalServerError,
  DiscountCardNotFoundError,
  RpcUnauthorizedError,
]);
export type DiscountsCardMutationError = Schema.Schema.Type<
  typeof DiscountsCardMutationError
>;
