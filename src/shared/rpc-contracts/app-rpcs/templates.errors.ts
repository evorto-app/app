import { Schema } from 'effect';

import {
  ForbiddenOrUnauthorizedRpcError,
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '../../errors/rpc-errors';

export type TemplateSimpleError =
  | TemplateSimpleBadRequestError
  | TemplateSimpleInternalError
  | TemplateSimpleNotFoundError;

export class TemplateSimpleBadRequestError extends Schema.TaggedError<TemplateSimpleBadRequestError>()(
  'TemplateSimpleBadRequestError',
  {
    message: Schema.String,
  },
) {}

export class TemplateSimpleInternalError extends Schema.TaggedError<TemplateSimpleInternalError>()(
  'TemplateSimpleInternalError',
  {
    message: Schema.String,
  },
) {}

export class TemplateSimpleNotFoundError extends Schema.TaggedError<TemplateSimpleNotFoundError>()(
  'TemplateSimpleNotFoundError',
  {
    message: Schema.String,
  },
) {}

export const TemplateSimpleRpcError = Schema.Union(
  RpcForbiddenError,
  RpcUnauthorizedError,
  TemplateSimpleBadRequestError,
  TemplateSimpleInternalError,
  TemplateSimpleNotFoundError,
);

export type TemplateSimpleRpcError = Schema.Schema.Type<
  typeof TemplateSimpleRpcError
>;

export const TemplatesGroupedByCategoryError = ForbiddenOrUnauthorizedRpcError;
export type TemplatesGroupedByCategoryError = ForbiddenOrUnauthorizedRpcError;
