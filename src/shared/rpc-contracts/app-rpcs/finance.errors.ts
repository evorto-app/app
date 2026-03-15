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

export class FinanceReceiptNotFoundError extends Schema.TaggedError<FinanceReceiptNotFoundError>()(
  'FinanceReceiptNotFoundError',
  {
    id: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

export class ReceiptMediaBadRequestError extends Schema.TaggedError<ReceiptMediaBadRequestError>()(
  'ReceiptMediaBadRequestError',
  {
    message: Schema.String,
  },
) {}

export class ReceiptMediaInternalError extends Schema.TaggedError<ReceiptMediaInternalError>()(
  'ReceiptMediaInternalError',
  {
    cause: Schema.optional(Schema.Defect),
    message: Schema.String,
  },
) {}

export class ReceiptMediaServiceUnavailableError extends Schema.TaggedError<ReceiptMediaServiceUnavailableError>()(
  'ReceiptMediaServiceUnavailableError',
  {
    cause: Schema.optional(Schema.Defect),
    message: Schema.String,
  },
) {}

export const FinanceRpcError = Schema.Union(
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  FinanceReceiptNotFoundError,
  RpcUnauthorizedError,
);
export type FinanceRpcError = Schema.Schema.Type<typeof FinanceRpcError>;
