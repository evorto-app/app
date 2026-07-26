import { Schema } from 'effect';

import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '../../errors/rpc-errors';

export type ReceiptMediaError =
  | ReceiptMediaBadRequestError
  | ReceiptMediaInternalError
  | ReceiptMediaServiceUnavailableError;

export class FinanceReceiptNotFoundError extends Schema.TaggedErrorClass<FinanceReceiptNotFoundError>()(
  'FinanceReceiptNotFoundError',
  {
    id: Schema.optional(Schema.String),
    message: Schema.String,
    resource: Schema.optional(Schema.String),
  },
) {}

export class FinanceResourceNotFoundError extends Schema.TaggedErrorClass<FinanceResourceNotFoundError>()(
  'FinanceResourceNotFoundError',
  {
    id: Schema.optional(Schema.String),
    message: Schema.String,
    resource: Schema.optional(Schema.String),
  },
) {}

export class ReceiptMediaBadRequestError extends Schema.TaggedErrorClass<ReceiptMediaBadRequestError>()(
  'ReceiptMediaBadRequestError',
  {
    message: Schema.String,
  },
) {}

export class ReceiptMediaInternalError extends Schema.TaggedErrorClass<ReceiptMediaInternalError>()(
  'ReceiptMediaInternalError',
  {
    message: Schema.String,
  },
) {}

export class ReceiptMediaServiceUnavailableError extends Schema.TaggedErrorClass<ReceiptMediaServiceUnavailableError>()(
  'ReceiptMediaServiceUnavailableError',
  {
    message: Schema.String,
  },
) {}

export const FinanceRpcError = Schema.Union([
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  FinanceReceiptNotFoundError,
  FinanceResourceNotFoundError,
  ReceiptMediaServiceUnavailableError,
  RpcUnauthorizedError,
]);
export type FinanceRpcError = Schema.Schema.Type<typeof FinanceRpcError>;
