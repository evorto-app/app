import { Schema } from 'effect';

import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '../../errors/rpc-errors';

export class IconSourceBusyError extends Schema.TaggedErrorClass<IconSourceBusyError>()(
  'IconSourceBusyError',
  {
    message: Schema.String,
  },
) {}

export class IconSourceUnavailableError extends Schema.TaggedErrorClass<IconSourceUnavailableError>()(
  'IconSourceUnavailableError',
  {
    iconName: Schema.String,
    message: Schema.String,
  },
) {}

export class InvalidIconNameError extends Schema.TaggedErrorClass<InvalidIconNameError>()(
  'InvalidIconNameError',
  {
    iconName: Schema.String,
    message: Schema.String,
  },
) {}

export const IconRpcError = Schema.Union([
  IconSourceBusyError,
  IconSourceUnavailableError,
  InvalidIconNameError,
  RpcForbiddenError,
  RpcUnauthorizedError,
]);
export type IconRpcError = Schema.Schema.Type<typeof IconRpcError>;
