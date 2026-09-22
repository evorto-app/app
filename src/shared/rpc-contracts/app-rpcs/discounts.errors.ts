import { Schema } from 'effect';

import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
  UnauthorizedRpcError,
} from '../../errors/rpc-errors';

export class DiscountCardChangedError extends Schema.TaggedErrorClass<DiscountCardChangedError>()(
  'DiscountCardChangedError',
  {
    message: Schema.String,
  },
) {}

export class DiscountCardConflictError extends Schema.TaggedErrorClass<DiscountCardConflictError>()(
  'DiscountCardConflictError',
  {
    message: Schema.String,
  },
) {}

export class DiscountCardNotFoundError extends Schema.TaggedErrorClass<DiscountCardNotFoundError>()(
  'DiscountCardNotFoundError',
  {
    message: Schema.String,
  },
) {}

export const DiscountsRpcError = UnauthorizedRpcError;
export type DiscountsRpcError = UnauthorizedRpcError;

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
