import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

export const IconRpcError = Schema.Literal('INVALID_ICON_NAME', 'UNAUTHORIZED');

export type IconRpcError = Schema.Schema.Type<typeof IconRpcError>;

export const IconRecord = Schema.Struct({
  commonName: Schema.NonEmptyString,
  friendlyName: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  sourceColor: Schema.NullOr(Schema.Number),
});

export type IconRecord = Schema.Schema.Type<typeof IconRecord>;

export const IconsSearch = asRpcQuery(
  Rpc.make('icons.search', {
    error: IconRpcError,
    payload: Schema.Struct({ search: Schema.String }),
    success: Schema.Array(IconRecord),
  }),
);

export const IconsAdd = asRpcMutation(
  Rpc.make('icons.add', {
    error: IconRpcError,
    payload: Schema.Struct({ icon: Schema.NonEmptyString }),
    success: Schema.Array(IconRecord),
  }),
);

export class IconsRpcs extends RpcGroup.make(
  IconsSearch,
  IconsAdd,
) {}
