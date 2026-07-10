import { Schema } from 'effect';

import {
  ForbiddenOrUnauthorizedRpcError,
  RpcBadRequestError,
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '../../errors/rpc-errors';

export type TemplateSimpleError =
  | TemplateSimpleBadRequestError
  | TemplateSimpleInternalError
  | TemplateSimpleNotFoundError;

export class TemplateSimpleBadRequestError extends Schema.TaggedErrorClass<TemplateSimpleBadRequestError>()(
  'TemplateSimpleBadRequestError',
  {
    message: Schema.String,
  },
) {}

export class TemplateSimpleInternalError extends Schema.TaggedErrorClass<TemplateSimpleInternalError>()(
  'TemplateSimpleInternalError',
  {
    message: Schema.String,
  },
) {}

export class TemplateSimpleNotFoundError extends Schema.TaggedErrorClass<TemplateSimpleNotFoundError>()(
  'TemplateSimpleNotFoundError',
  {
    message: Schema.String,
  },
) {}

export const TemplateSimpleRpcError = Schema.Union([
  RpcForbiddenError,
  RpcUnauthorizedError,
  TemplateSimpleBadRequestError,
  TemplateSimpleInternalError,
  TemplateSimpleNotFoundError,
]);

export type TemplateSimpleRpcError = Schema.Schema.Type<
  typeof TemplateSimpleRpcError
>;

export const TemplateGraphRpcError = Schema.Union([
  RpcBadRequestError,
  RpcForbiddenError,
  RpcUnauthorizedError,
]);

export type TemplateGraphRpcError = Schema.Schema.Type<
  typeof TemplateGraphRpcError
>;

export const TemplatesGroupedByCategoryError = ForbiddenOrUnauthorizedRpcError;
export type TemplatesGroupedByCategoryError = ForbiddenOrUnauthorizedRpcError;
