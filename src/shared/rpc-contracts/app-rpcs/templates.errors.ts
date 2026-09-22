import { Schema } from 'effect';

import {
  ForbiddenOrUnauthorizedRpcError,
  RpcBadRequestError,
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '../../errors/rpc-errors';

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
