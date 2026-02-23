/* eslint-disable unicorn/throw-new-error */

import { Schema } from 'effect';

export type ReceiptMediaError =
  | ReceiptMediaBadRequestError
  | ReceiptMediaInternalError
  | ReceiptMediaServiceUnavailableError;

export class ReceiptMediaBadRequestError extends Schema.TaggedError<ReceiptMediaBadRequestError>()(
  'ReceiptMediaBadRequestError',
  {
    message: Schema.String,
  },
) {}

export class ReceiptMediaInternalError extends Schema.TaggedError<ReceiptMediaInternalError>()(
  'ReceiptMediaInternalError',
  {
    message: Schema.String,
  },
) {}

export class ReceiptMediaServiceUnavailableError extends Schema.TaggedError<ReceiptMediaServiceUnavailableError>()(
  'ReceiptMediaServiceUnavailableError',
  {
    message: Schema.String,
  },
) {}
