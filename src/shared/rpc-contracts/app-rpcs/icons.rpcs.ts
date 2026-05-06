import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { IconRpcError } from './icons.errors';

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

export class IconsRpcs extends RpcGroup.make(IconsSearch, IconsAdd) {}
