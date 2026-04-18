import { Schema } from 'effect';

import { RpcUnauthorizedError } from '../../errors/rpc-errors';

export class InvalidIconNameError extends Schema.TaggedError<InvalidIconNameError>()(
  'InvalidIconNameError',
  {
    iconName: Schema.String,
    message: Schema.String,
  },
) {}

export const IconRpcError = Schema.Union(
  InvalidIconNameError,
  RpcUnauthorizedError,
);
export type IconRpcError = Schema.Schema.Type<typeof IconRpcError>;
